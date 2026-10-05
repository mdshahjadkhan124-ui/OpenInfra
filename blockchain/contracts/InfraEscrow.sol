// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title  InfraEscrow
 * @author MD SHAHJAD KHAN
 * @notice Staged escrow for public infrastructure repair contracts.
 *
 * A government admin locks the agreed funds for an awarded project, then
 * releases them to the contractor one milestone at a time, only after the work
 * for that milestone has been verified off-chain. Every state change emits an
 * event, so the full money trail is reconstructable from logs alone and any
 * citizen can audit it on Etherscan without trusting this platform's database.
 *
 * ---------------------------------------------------------------------------
 * DESIGN DECISIONS
 * ---------------------------------------------------------------------------
 *
 * 1. ONE REGISTRY, NOT ONE CONTRACT PER PROJECT.
 *    Deploying a fresh contract per project would cost a deployment every time
 *    and scatter the money trail across dozens of addresses. A single registry
 *    gives the transparency dashboard one permanent address to link to, and
 *    makes `totalEscrowed` a meaningful figure.
 *
 * 2. THE ADMIN CAN NEVER WITHDRAW. There is deliberately no admin withdrawal,
 *    refund or sweep function. Once funds are locked the only way out of this
 *    contract is `releaseMilestone`, which pays the project's contractor and
 *    nobody else. That is the core guarantee the platform makes to citizens:
 *    the official who holds the keys cannot take the money back.
 *
 *    The cost of that guarantee is real and worth stating: if a contractor
 *    abandons a part-finished project, its remaining funds stay locked in this
 *    contract permanently. A production system would want a time-locked
 *    dispute path (e.g. an arbitrator address, or a refund unlockable only
 *    after N months of inactivity). That is left out here on purpose, because
 *    any such escape hatch weakens the guarantee above and designing one that
 *    cannot be abused is a larger problem than this project needs to solve.
 *
 * 3. MILESTONE AMOUNTS ARE FIXED AT CREATION and must sum exactly to the
 *    total that gets deposited. Percentages are resolved off-chain into wei
 *    before they reach this contract: integer division of a percentage on-chain
 *    would leave dust that could never be released, because the sum would no
 *    longer equal the deposit.
 *
 * 4. CHECKS-EFFECTS-INTERACTIONS. A milestone is marked Released and the
 *    running total incremented *before* the transfer, so a reentrant call sees
 *    the milestone as already paid. `nonReentrant` is belt-and-braces on top.
 */
contract InfraEscrow is Ownable, ReentrancyGuard {
    // -----------------------------------------------------------------------
    // Types
    // -----------------------------------------------------------------------

    enum MilestoneStatus {
        Pending, // declared, not yet paid
        Released // paid to the contractor; terminal
    }

    struct Milestone {
        uint256 amount;
        MilestoneStatus status;
        uint64 releasedAt;
        bytes32 evidenceHash; // optional off-chain proof reference
    }

    struct Project {
        string offChainId; // the platform's database id, for cross-referencing
        address contractor;
        uint256 totalAmount;
        uint256 releasedAmount;
        bool funded;
        bool exists;
        uint64 createdAt;
        uint64 fundedAt;
    }

    /**
     * @dev What `getProject` returns.
     *
     * A struct rather than a tuple of eight values: eight named returns
     * overflowed the EVM stack ("stack too deep"), and a struct also gives the
     * backend and the dashboard named fields instead of positional ones.
     * `exists` is dropped — a non-existent project reverts instead.
     */
    struct ProjectView {
        string offChainId;
        address contractor;
        uint256 totalAmount;
        uint256 releasedAmount;
        uint256 remainingAmount;
        bool funded;
        bool completed;
        uint256 milestoneCount;
        uint64 createdAt;
        uint64 fundedAt;
    }

    // -----------------------------------------------------------------------
    // Storage
    // -----------------------------------------------------------------------

    /// @dev Bounded so a project can never be created whose milestones cannot
    ///      all be iterated within the block gas limit.
    uint256 public constant MAX_MILESTONES = 20;

    uint256 private _projectCount;

    mapping(uint256 => Project) private _projects;
    mapping(uint256 => Milestone[]) private _milestones;

    /// @notice Links a platform database id back to its on-chain project id.
    /// @dev    Stored as keccak256(offChainId) because mappings cannot be keyed
    ///         by string. Value is projectId + 1, so zero means "absent".
    mapping(bytes32 => uint256) private _projectIdByOffChainId;

    /// @notice Total ever locked, and total ever released, across all projects.
    uint256 public totalEscrowed;
    uint256 public totalReleased;

    // -----------------------------------------------------------------------
    // Events — one for every state change
    // -----------------------------------------------------------------------

    event ProjectCreated(
        uint256 indexed projectId,
        string offChainId,
        address indexed contractor,
        uint256 totalAmount,
        uint256 milestoneCount
    );

    event FundsLocked(uint256 indexed projectId, address indexed depositor, uint256 amount);

    event MilestoneReleased(
        uint256 indexed projectId,
        uint256 indexed milestoneIndex,
        address indexed contractor,
        uint256 amount,
        bytes32 evidenceHash
    );

    event ProjectCompleted(uint256 indexed projectId, address indexed contractor, uint256 totalReleasedForProject);

    // -----------------------------------------------------------------------
    // Errors — cheaper than revert strings and self-documenting in traces
    // -----------------------------------------------------------------------

    error ProjectDoesNotExist(uint256 projectId);
    error ProjectAlreadyFunded(uint256 projectId);
    error ProjectNotFunded(uint256 projectId);
    error DuplicateOffChainId(string offChainId);
    error InvalidContractor();
    error NoMilestones();
    error TooManyMilestones(uint256 provided, uint256 maximum);
    error ZeroMilestoneAmount(uint256 index);
    error IncorrectDepositAmount(uint256 expected, uint256 provided);
    error MilestoneIndexOutOfRange(uint256 projectId, uint256 index);
    error MilestoneAlreadyReleased(uint256 projectId, uint256 index);
    error TransferFailed(address to, uint256 amount);
    error EmptyOffChainId();

    // -----------------------------------------------------------------------
    // Construction
    // -----------------------------------------------------------------------

    /**
     * @param admin The government wallet permitted to create projects, lock
     *              funds and release milestones. Ownership is transferable via
     *              OpenZeppelin's `transferOwnership`, so a compromised or
     *              rotated key does not strand every project.
     */
    constructor(address admin) Ownable(admin) {}

    // -----------------------------------------------------------------------
    // Admin: project setup
    // -----------------------------------------------------------------------

    /**
     * @notice Declare an awarded project and its milestone schedule.
     * @dev    The total is derived from the milestone amounts rather than taken
     *         as a parameter, which makes "milestones must sum to the total"
     *         true by construction instead of by assertion.
     *
     * @param offChainId        The platform's database id for this project.
     * @param contractor        Wallet that will receive every milestone payment.
     * @param milestoneAmounts  Per-milestone amounts in wei, in order.
     * @return projectId        The on-chain id of the new project.
     */
    function createProject(
        string calldata offChainId,
        address contractor,
        uint256[] calldata milestoneAmounts
    ) external onlyOwner returns (uint256 projectId) {
        if (bytes(offChainId).length == 0) revert EmptyOffChainId();
        if (contractor == address(0)) revert InvalidContractor();
        if (milestoneAmounts.length == 0) revert NoMilestones();
        if (milestoneAmounts.length > MAX_MILESTONES) {
            revert TooManyMilestones(milestoneAmounts.length, MAX_MILESTONES);
        }

        bytes32 key = keccak256(bytes(offChainId));
        if (_projectIdByOffChainId[key] != 0) revert DuplicateOffChainId(offChainId);

        uint256 total;
        for (uint256 i = 0; i < milestoneAmounts.length; ++i) {
            // A zero-amount milestone would be releasable for nothing, which
            // makes the on-chain record misleading rather than merely useless.
            if (milestoneAmounts[i] == 0) revert ZeroMilestoneAmount(i);
            total += milestoneAmounts[i];
        }

        projectId = _projectCount++;

        _projects[projectId] = Project({
            offChainId: offChainId,
            contractor: contractor,
            totalAmount: total,
            releasedAmount: 0,
            funded: false,
            exists: true,
            createdAt: uint64(block.timestamp),
            fundedAt: 0
        });

        Milestone[] storage ms = _milestones[projectId];
        for (uint256 i = 0; i < milestoneAmounts.length; ++i) {
            ms.push(
                Milestone({
                    amount: milestoneAmounts[i],
                    status: MilestoneStatus.Pending,
                    releasedAt: 0,
                    evidenceHash: bytes32(0)
                })
            );
        }

        // +1 so that a stored zero can be distinguished from "not present".
        _projectIdByOffChainId[key] = projectId + 1;

        emit ProjectCreated(projectId, offChainId, contractor, total, milestoneAmounts.length);
    }

    /**
     * @notice Deposit the full agreed amount for a project.
     * @dev    Requires the exact total. Accepting less would create a project
     *         whose final milestone could never be paid; accepting more would
     *         leave a surplus that no function can ever move out.
     */
    function lockFunds(uint256 projectId) external payable onlyOwner {
        Project storage project = _projects[projectId];
        if (!project.exists) revert ProjectDoesNotExist(projectId);
        if (project.funded) revert ProjectAlreadyFunded(projectId);
        if (msg.value != project.totalAmount) {
            revert IncorrectDepositAmount(project.totalAmount, msg.value);
        }

        project.funded = true;
        project.fundedAt = uint64(block.timestamp);
        totalEscrowed += msg.value;

        emit FundsLocked(projectId, msg.sender, msg.value);
    }

    /**
     * @notice Create and fund a project in one transaction.
     * @dev    Convenience for the backend: the two-step path can leave a
     *         project declared but unfunded if the second transaction fails,
     *         and a project that exists on-chain but holds no money is a
     *         confusing thing to show on a public dashboard.
     */
    function createAndFundProject(
        string calldata offChainId,
        address contractor,
        uint256[] calldata milestoneAmounts
    ) external payable onlyOwner returns (uint256 projectId) {
        if (bytes(offChainId).length == 0) revert EmptyOffChainId();
        if (contractor == address(0)) revert InvalidContractor();
        if (milestoneAmounts.length == 0) revert NoMilestones();
        if (milestoneAmounts.length > MAX_MILESTONES) {
            revert TooManyMilestones(milestoneAmounts.length, MAX_MILESTONES);
        }

        bytes32 key = keccak256(bytes(offChainId));
        if (_projectIdByOffChainId[key] != 0) revert DuplicateOffChainId(offChainId);

        uint256 total;
        for (uint256 i = 0; i < milestoneAmounts.length; ++i) {
            if (milestoneAmounts[i] == 0) revert ZeroMilestoneAmount(i);
            total += milestoneAmounts[i];
        }
        if (msg.value != total) revert IncorrectDepositAmount(total, msg.value);

        projectId = _projectCount++;

        _projects[projectId] = Project({
            offChainId: offChainId,
            contractor: contractor,
            totalAmount: total,
            releasedAmount: 0,
            funded: true,
            exists: true,
            createdAt: uint64(block.timestamp),
            fundedAt: uint64(block.timestamp)
        });

        Milestone[] storage ms = _milestones[projectId];
        for (uint256 i = 0; i < milestoneAmounts.length; ++i) {
            ms.push(
                Milestone({
                    amount: milestoneAmounts[i],
                    status: MilestoneStatus.Pending,
                    releasedAt: 0,
                    evidenceHash: bytes32(0)
                })
            );
        }

        _projectIdByOffChainId[key] = projectId + 1;
        totalEscrowed += msg.value;

        emit ProjectCreated(projectId, offChainId, contractor, total, milestoneAmounts.length);
        emit FundsLocked(projectId, msg.sender, msg.value);
    }

    // -----------------------------------------------------------------------
    // Admin: milestone release
    // -----------------------------------------------------------------------

    /**
     * @notice Release one milestone's funds to the project's contractor.
     * @dev    Admin-only, and only after the work has been verified off-chain.
     *         A milestone can never be paid twice: its status is set to
     *         Released before the transfer, and a second attempt reverts with
     *         MilestoneAlreadyReleased.
     *
     * @param projectId      The project.
     * @param milestoneIndex Zero-based index into the milestone schedule.
     * @param evidenceHash   Optional hash of the off-chain approval record
     *                       (progress photo, AI verdict, admin sign-off). Kept
     *                       on-chain so the payment can be tied to the evidence
     *                       that justified it. Pass bytes32(0) to omit.
     */
    function releaseMilestone(
        uint256 projectId,
        uint256 milestoneIndex,
        bytes32 evidenceHash
    ) external onlyOwner nonReentrant {
        Project storage project = _projects[projectId];
        if (!project.exists) revert ProjectDoesNotExist(projectId);
        // Funds cannot leave before they have arrived.
        if (!project.funded) revert ProjectNotFunded(projectId);

        Milestone[] storage ms = _milestones[projectId];
        if (milestoneIndex >= ms.length) revert MilestoneIndexOutOfRange(projectId, milestoneIndex);

        Milestone storage milestone = ms[milestoneIndex];
        if (milestone.status == MilestoneStatus.Released) {
            revert MilestoneAlreadyReleased(projectId, milestoneIndex);
        }

        uint256 amount = milestone.amount;
        address contractor = project.contractor;

        // --- Effects before interaction ---
        milestone.status = MilestoneStatus.Released;
        milestone.releasedAt = uint64(block.timestamp);
        milestone.evidenceHash = evidenceHash;
        project.releasedAmount += amount;
        totalReleased += amount;

        // --- Interaction ---
        // `call` rather than `transfer`: a 2300-gas stipend would fail for a
        // contractor using a smart-contract wallet, and the return value is
        // checked explicitly rather than relying on a revert.
        (bool ok, ) = contractor.call{value: amount}("");
        if (!ok) revert TransferFailed(contractor, amount);

        emit MilestoneReleased(projectId, milestoneIndex, contractor, amount, evidenceHash);

        if (project.releasedAmount == project.totalAmount) {
            emit ProjectCompleted(projectId, contractor, project.releasedAmount);
        }
    }

    // -----------------------------------------------------------------------
    // Views
    // -----------------------------------------------------------------------

    function projectCount() external view returns (uint256) {
        return _projectCount;
    }

    function getProject(uint256 projectId) external view returns (ProjectView memory) {
        Project storage p = _projects[projectId];
        if (!p.exists) revert ProjectDoesNotExist(projectId);

        return
            ProjectView({
                offChainId: p.offChainId,
                contractor: p.contractor,
                totalAmount: p.totalAmount,
                releasedAmount: p.releasedAmount,
                remainingAmount: p.funded ? p.totalAmount - p.releasedAmount : 0,
                funded: p.funded,
                completed: p.funded && p.releasedAmount == p.totalAmount,
                milestoneCount: _milestones[projectId].length,
                createdAt: p.createdAt,
                fundedAt: p.fundedAt
            });
    }

    function getMilestone(
        uint256 projectId,
        uint256 milestoneIndex
    ) external view returns (uint256 amount, MilestoneStatus status, uint64 releasedAt, bytes32 evidenceHash) {
        if (!_projects[projectId].exists) revert ProjectDoesNotExist(projectId);
        Milestone[] storage ms = _milestones[projectId];
        if (milestoneIndex >= ms.length) revert MilestoneIndexOutOfRange(projectId, milestoneIndex);
        Milestone storage m = ms[milestoneIndex];
        return (m.amount, m.status, m.releasedAt, m.evidenceHash);
    }

    /// @notice The whole milestone schedule in one call, for the dashboard.
    function getMilestones(uint256 projectId) external view returns (Milestone[] memory) {
        if (!_projects[projectId].exists) revert ProjectDoesNotExist(projectId);
        return _milestones[projectId];
    }

    /// @notice Funds still held for a project: the total less what was released.
    function remainingFunds(uint256 projectId) external view returns (uint256) {
        Project storage p = _projects[projectId];
        if (!p.exists) revert ProjectDoesNotExist(projectId);
        if (!p.funded) return 0;
        return p.totalAmount - p.releasedAmount;
    }

    function isMilestoneReleased(uint256 projectId, uint256 milestoneIndex) external view returns (bool) {
        if (!_projects[projectId].exists) revert ProjectDoesNotExist(projectId);
        Milestone[] storage ms = _milestones[projectId];
        if (milestoneIndex >= ms.length) revert MilestoneIndexOutOfRange(projectId, milestoneIndex);
        return ms[milestoneIndex].status == MilestoneStatus.Released;
    }

    function isProjectComplete(uint256 projectId) external view returns (bool) {
        Project storage p = _projects[projectId];
        if (!p.exists) revert ProjectDoesNotExist(projectId);
        return p.funded && p.releasedAmount == p.totalAmount;
    }

    /// @notice Resolve a platform database id to its on-chain project id.
    function projectIdForOffChainId(string calldata offChainId) external view returns (bool found, uint256 projectId) {
        uint256 stored = _projectIdByOffChainId[keccak256(bytes(offChainId))];
        if (stored == 0) return (false, 0);
        return (true, stored - 1);
    }

    /// @notice Live balance. Should equal totalEscrowed - totalReleased.
    function contractBalance() external view returns (uint256) {
        return address(this).balance;
    }

    // -----------------------------------------------------------------------
    // Fallbacks
    // -----------------------------------------------------------------------

    /**
     * @dev No `receive` or `fallback` is defined, so a plain transfer to this
     *      contract reverts. Funds that arrived outside `lockFunds` would not
     *      belong to any project and could never be released — better to
     *      reject them at the door than to trap them.
     */
}
