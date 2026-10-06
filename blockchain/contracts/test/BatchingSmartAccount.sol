// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * @title  BatchingSmartAccount
 * @notice TEST FIXTURE ONLY — never deployed to a live network.
 *
 * Stands in for the delegation contract a modern wallet routes calls through.
 * MetaMask's smart-account batching (EIP-7702) does exactly this: the user's
 * account delegates to a contract, that contract calls the target, and so the
 * transaction's `to` is the delegation contract rather than the target.
 *
 * It exists because the backend originally verified a payment by requiring the
 * transaction receipt's `to` to equal the escrow address. A real milestone
 * payment made through a smart account was therefore rejected while the funds
 * had moved and the escrow had emitted MilestoneReleased — the contractor was
 * paid on-chain and unpaid on the public record.
 *
 * The lesson this fixture pins: the escrow is still the EMITTER of the event
 * even when it is not the recipient of the transaction. Verification must look
 * at `log.address`, not at `receipt.to`.
 *
 * Note the escrow's `onlyOwner` guard means THIS contract must be the owner for
 * a release to go through — which mirrors reality, where the delegation
 * contract acts with the user's authority.
 */
interface IInfraEscrowBatch {
    function releaseMilestone(uint256 projectId, uint256 milestoneIndex, bytes32 evidenceHash) external;
}

contract BatchingSmartAccount {
    IInfraEscrowBatch public immutable escrow;

    /// Emitted alongside the escrow's own event, as a wallet's own log would be.
    event BatchExecuted(uint256 calls);

    constructor(address escrowAddress) {
        escrow = IInfraEscrowBatch(escrowAddress);
    }

    /**
     * Release one milestone through this contract.
     *
     * The resulting receipt has `to == address(this)`, while the
     * MilestoneReleased log carries `address == address(escrow)`.
     */
    function releaseOne(uint256 projectId, uint256 milestoneIndex, bytes32 evidenceHash) external {
        escrow.releaseMilestone(projectId, milestoneIndex, evidenceHash);
        emit BatchExecuted(1);
    }

    /** Several releases in one transaction, which is the point of batching. */
    function releaseMany(
        uint256 projectId,
        uint256[] calldata milestoneIndexes,
        bytes32 evidenceHash
    ) external {
        for (uint256 i = 0; i < milestoneIndexes.length; i++) {
            escrow.releaseMilestone(projectId, milestoneIndexes[i], evidenceHash);
        }
        emit BatchExecuted(milestoneIndexes.length);
    }
}
