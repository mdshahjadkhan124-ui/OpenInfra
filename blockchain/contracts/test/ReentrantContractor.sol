// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * @title  ReentrantContractor
 * @notice TEST FIXTURE ONLY — never deployed to a live network.
 *
 * A malicious "contractor" that tries to re-enter InfraEscrow from its
 * `receive` hook the moment it is paid, attempting to collect the same
 * milestone more than once.
 *
 * It must fail. InfraEscrow marks a milestone Released and increments the
 * running totals *before* transferring (checks-effects-interactions), so a
 * reentrant call finds the milestone already paid; `nonReentrant` blocks it
 * independently of that ordering.
 */
interface IInfraEscrow {
    function releaseMilestone(uint256 projectId, uint256 milestoneIndex, bytes32 evidenceHash) external;
}

contract ReentrantContractor {
    IInfraEscrow public immutable escrow;

    uint256 public reentryAttempts;
    uint256 public amountReceived;

    constructor(address escrowAddress) {
        escrow = IInfraEscrow(escrowAddress);
    }

    /// @dev Re-enter on the first payment only, so the test cannot loop forever.
    receive() external payable {
        amountReceived += msg.value;

        if (reentryAttempts == 0) {
            reentryAttempts = 1;
            // Attempt to be paid for the same milestone a second time.
            escrow.releaseMilestone(0, 0, bytes32(0));
        }
    }
}
