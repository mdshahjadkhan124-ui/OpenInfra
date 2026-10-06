/**
 * InfraEscrow — unit tests on the in-process Hardhat network.
 *
 * Organised around the guarantees the contract makes, because those are what
 * a reviewer actually wants reassurance about:
 *
 *   • only the admin can move money
 *   • funds cannot leave before they arrive
 *   • a milestone can never be paid twice
 *   • milestone amounts always sum to the deposit
 *   • the admin can never withdraw
 *   • every state change emits an event
 */
import { expect } from 'chai';
import { network } from 'hardhat';

const { ethers } = await network.getOrCreate();

const eth = (n) => ethers.parseEther(String(n));

describe('InfraEscrow', () => {
  let escrow;
  let admin;
  let contractor;
  let outsider;
  let otherContractor;

  /** Three milestones summing to 1.0 ETH — 30% / 45% / 25%. */
  const MILESTONES = [eth('0.3'), eth('0.45'), eth('0.25')];
  const TOTAL = eth('1.0');
  const OFF_CHAIN_ID = '6ac3f4de25f39e11c0f1a621';

  beforeEach(async () => {
    [admin, contractor, outsider, otherContractor] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory('InfraEscrow');
    escrow = await Factory.deploy(admin.address);
    await escrow.waitForDeployment();
  });

  /** Create + fund a project, returning its id. */
  const createFunded = async (overrides = {}) => {
    const {
      offChainId = OFF_CHAIN_ID,
      to = contractor.address,
      milestones = MILESTONES,
      value = TOTAL,
    } = overrides;
    await escrow.createAndFundProject(offChainId, to, milestones, { value });
    return (await escrow.projectCount()) - 1n;
  };

  // =======================================================================
  describe('deployment', () => {
    it('sets the admin as owner', async () => {
      expect(await escrow.owner()).to.equal(admin.address);
    });

    it('starts empty', async () => {
      expect(await escrow.projectCount()).to.equal(0n);
      expect(await escrow.totalEscrowed()).to.equal(0n);
      expect(await escrow.totalReleased()).to.equal(0n);
      expect(await escrow.contractBalance()).to.equal(0n);
    });

    it('caps the milestone count', async () => {
      expect(await escrow.MAX_MILESTONES()).to.equal(20n);
    });
  });

  // =======================================================================
  describe('createProject', () => {
    it('derives the total from the milestone amounts', async () => {
      await escrow.createProject(OFF_CHAIN_ID, contractor.address, MILESTONES);
      const p = await escrow.getProject(0);

      // "Milestones must sum to the total" is true by construction here: the
      // total is never supplied, only derived.
      expect(p.totalAmount).to.equal(TOTAL);
      expect(p.milestoneCount).to.equal(3n);
      expect(p.contractor).to.equal(contractor.address);
      expect(p.offChainId).to.equal(OFF_CHAIN_ID);
      expect(p.funded).to.equal(false);
      expect(p.releasedAmount).to.equal(0n);
    });

    it('emits ProjectCreated', async () => {
      await expect(escrow.createProject(OFF_CHAIN_ID, contractor.address, MILESTONES))
        .to.emit(escrow, 'ProjectCreated')
        .withArgs(0n, OFF_CHAIN_ID, contractor.address, TOTAL, 3n);
    });

    it('stores every milestone as Pending', async () => {
      await escrow.createProject(OFF_CHAIN_ID, contractor.address, MILESTONES);
      const ms = await escrow.getMilestones(0);
      expect(ms.length).to.equal(3);
      for (let i = 0; i < ms.length; i++) {
        expect(ms[i].amount).to.equal(MILESTONES[i]);
        expect(ms[i].status).to.equal(0n); // Pending
        expect(ms[i].releasedAt).to.equal(0n);
      }
    });

    it('increments ids', async () => {
      await escrow.createProject('a', contractor.address, MILESTONES);
      await escrow.createProject('b', contractor.address, MILESTONES);
      expect(await escrow.projectCount()).to.equal(2n);
    });

    it('rejects a non-admin caller', async () => {
      await expect(
        escrow.connect(outsider).createProject(OFF_CHAIN_ID, contractor.address, MILESTONES)
      ).to.be.revertedWithCustomError(escrow, 'OwnableUnauthorizedAccount');
    });

    it('rejects the zero address as contractor', async () => {
      await expect(
        escrow.createProject(OFF_CHAIN_ID, ethers.ZeroAddress, MILESTONES)
      ).to.be.revertedWithCustomError(escrow, 'InvalidContractor');
    });

    it('rejects an empty off-chain id', async () => {
      await expect(
        escrow.createProject('', contractor.address, MILESTONES)
      ).to.be.revertedWithCustomError(escrow, 'EmptyOffChainId');
    });

    it('rejects an empty milestone schedule', async () => {
      await expect(
        escrow.createProject(OFF_CHAIN_ID, contractor.address, [])
      ).to.be.revertedWithCustomError(escrow, 'NoMilestones');
    });

    it('rejects a zero-amount milestone', async () => {
      await expect(
        escrow.createProject(OFF_CHAIN_ID, contractor.address, [eth('0.5'), 0n, eth('0.5')])
      )
        .to.be.revertedWithCustomError(escrow, 'ZeroMilestoneAmount')
        .withArgs(1n);
    });

    it('rejects more than MAX_MILESTONES', async () => {
      const tooMany = Array.from({ length: 21 }, () => eth('0.01'));
      await expect(escrow.createProject(OFF_CHAIN_ID, contractor.address, tooMany))
        .to.be.revertedWithCustomError(escrow, 'TooManyMilestones')
        .withArgs(21n, 20n);
    });

    it('accepts exactly MAX_MILESTONES', async () => {
      const exact = Array.from({ length: 20 }, () => eth('0.01'));
      await escrow.createProject(OFF_CHAIN_ID, contractor.address, exact);
      expect((await escrow.getProject(0)).milestoneCount).to.equal(20n);
    });

    it('rejects a duplicate off-chain id', async () => {
      await escrow.createProject(OFF_CHAIN_ID, contractor.address, MILESTONES);
      // Guards against the backend double-submitting and escrowing twice for
      // one database project.
      await expect(escrow.createProject(OFF_CHAIN_ID, contractor.address, MILESTONES))
        .to.be.revertedWithCustomError(escrow, 'DuplicateOffChainId')
        .withArgs(OFF_CHAIN_ID);
    });

    it('resolves an off-chain id back to its project id', async () => {
      await escrow.createProject('first', contractor.address, MILESTONES);
      await escrow.createProject('second', contractor.address, MILESTONES);

      const [found0, id0] = await escrow.projectIdForOffChainId('first');
      expect(found0).to.equal(true);
      expect(id0).to.equal(0n);

      const [found1, id1] = await escrow.projectIdForOffChainId('second');
      expect(found1).to.equal(true);
      expect(id1).to.equal(1n);

      const [missing] = await escrow.projectIdForOffChainId('nope');
      expect(missing).to.equal(false);
    });
  });

  // =======================================================================
  describe('lockFunds', () => {
    beforeEach(async () => {
      await escrow.createProject(OFF_CHAIN_ID, contractor.address, MILESTONES);
    });

    it('accepts the exact total and records it', async () => {
      await escrow.lockFunds(0, { value: TOTAL });
      const p = await escrow.getProject(0);
      expect(p.funded).to.equal(true);
      expect(p.remainingAmount).to.equal(TOTAL);
      expect(await escrow.contractBalance()).to.equal(TOTAL);
      expect(await escrow.totalEscrowed()).to.equal(TOTAL);
    });

    it('emits FundsLocked', async () => {
      await expect(escrow.lockFunds(0, { value: TOTAL }))
        .to.emit(escrow, 'FundsLocked')
        .withArgs(0n, admin.address, TOTAL);
    });

    it('rejects an underpayment', async () => {
      // Accepting less would leave a milestone that could never be paid.
      await expect(escrow.lockFunds(0, { value: eth('0.9') }))
        .to.be.revertedWithCustomError(escrow, 'IncorrectDepositAmount')
        .withArgs(TOTAL, eth('0.9'));
    });

    it('rejects an overpayment', async () => {
      // Accepting more would trap a surplus no function can move out.
      await expect(escrow.lockFunds(0, { value: eth('1.1') }))
        .to.be.revertedWithCustomError(escrow, 'IncorrectDepositAmount')
        .withArgs(TOTAL, eth('1.1'));
    });

    it('rejects a non-admin depositor', async () => {
      await expect(
        escrow.connect(outsider).lockFunds(0, { value: TOTAL })
      ).to.be.revertedWithCustomError(escrow, 'OwnableUnauthorizedAccount');
    });

    it('rejects double funding', async () => {
      await escrow.lockFunds(0, { value: TOTAL });
      await expect(escrow.lockFunds(0, { value: TOTAL }))
        .to.be.revertedWithCustomError(escrow, 'ProjectAlreadyFunded')
        .withArgs(0n);
    });

    it('rejects an unknown project', async () => {
      await expect(escrow.lockFunds(99, { value: TOTAL }))
        .to.be.revertedWithCustomError(escrow, 'ProjectDoesNotExist')
        .withArgs(99n);
    });
  });

  // =======================================================================
  describe('createAndFundProject', () => {
    it('creates and funds atomically', async () => {
      await escrow.createAndFundProject(OFF_CHAIN_ID, contractor.address, MILESTONES, { value: TOTAL });
      const p = await escrow.getProject(0);
      expect(p.funded).to.equal(true);
      expect(p.totalAmount).to.equal(TOTAL);
      expect(await escrow.contractBalance()).to.equal(TOTAL);
    });

    it('emits both events', async () => {
      const tx = escrow.createAndFundProject(OFF_CHAIN_ID, contractor.address, MILESTONES, { value: TOTAL });
      await expect(tx).to.emit(escrow, 'ProjectCreated');
      await expect(tx).to.emit(escrow, 'FundsLocked');
    });

    it('rejects a mismatched deposit', async () => {
      await expect(
        escrow.createAndFundProject(OFF_CHAIN_ID, contractor.address, MILESTONES, { value: eth('0.99') })
      ).to.be.revertedWithCustomError(escrow, 'IncorrectDepositAmount');
    });

    it('rejects a non-admin caller', async () => {
      await expect(
        escrow
          .connect(outsider)
          .createAndFundProject(OFF_CHAIN_ID, contractor.address, MILESTONES, { value: TOTAL })
      ).to.be.revertedWithCustomError(escrow, 'OwnableUnauthorizedAccount');
    });

    it('leaves nothing behind when it reverts', async () => {
      await expect(
        escrow.createAndFundProject(OFF_CHAIN_ID, contractor.address, MILESTONES, { value: eth('0.5') })
      ).to.be.revert(ethers);
      expect(await escrow.projectCount()).to.equal(0n);
      expect(await escrow.contractBalance()).to.equal(0n);
    });
  });

  // =======================================================================
  describe('releaseMilestone', () => {
    let projectId;

    beforeEach(async () => {
      projectId = await createFunded();
    });

    it('pays the contractor the exact milestone amount', async () => {
      const before = await ethers.provider.getBalance(contractor.address);
      await escrow.releaseMilestone(projectId, 0, ethers.ZeroHash);
      const after = await ethers.provider.getBalance(contractor.address);

      expect(after - before).to.equal(MILESTONES[0]);
    });

    it('emits MilestoneReleased', async () => {
      await expect(escrow.releaseMilestone(projectId, 1, ethers.ZeroHash))
        .to.emit(escrow, 'MilestoneReleased')
        .withArgs(projectId, 1n, contractor.address, MILESTONES[1], ethers.ZeroHash);
    });

    it('marks the milestone Released with a timestamp', async () => {
      await escrow.releaseMilestone(projectId, 0, ethers.ZeroHash);
      const m = await escrow.getMilestone(projectId, 0);
      expect(m.status).to.equal(1n); // Released
      expect(m.releasedAt).to.be.greaterThan(0n);
      expect(await escrow.isMilestoneReleased(projectId, 0)).to.equal(true);
    });

    it('records the evidence hash that justified the payment', async () => {
      const evidence = ethers.keccak256(ethers.toUtf8Bytes('milestone-1-approved-by-admin'));
      await expect(escrow.releaseMilestone(projectId, 0, evidence))
        .to.emit(escrow, 'MilestoneReleased')
        .withArgs(projectId, 0n, contractor.address, MILESTONES[0], evidence);

      const m = await escrow.getMilestone(projectId, 0);
      expect(m.evidenceHash).to.equal(evidence);
    });

    it('updates running totals and the remaining balance', async () => {
      await escrow.releaseMilestone(projectId, 0, ethers.ZeroHash);
      const p = await escrow.getProject(projectId);

      expect(p.releasedAmount).to.equal(MILESTONES[0]);
      expect(p.remainingAmount).to.equal(TOTAL - MILESTONES[0]);
      expect(await escrow.totalReleased()).to.equal(MILESTONES[0]);
      expect(await escrow.contractBalance()).to.equal(TOTAL - MILESTONES[0]);
    });

    it('releases out of order', async () => {
      // Nothing requires milestone 0 before milestone 2; the admin may verify
      // work in whatever order it is completed.
      await escrow.releaseMilestone(projectId, 2, ethers.ZeroHash);
      expect(await escrow.isMilestoneReleased(projectId, 2)).to.equal(true);
      expect(await escrow.isMilestoneReleased(projectId, 0)).to.equal(false);
    });

    // --- THE CENTRAL GUARANTEE -------------------------------------------
    it('NEVER pays a milestone twice', async () => {
      await escrow.releaseMilestone(projectId, 0, ethers.ZeroHash);

      await expect(escrow.releaseMilestone(projectId, 0, ethers.ZeroHash))
        .to.be.revertedWithCustomError(escrow, 'MilestoneAlreadyReleased')
        .withArgs(projectId, 0n);

      // And the balance is untouched by the failed attempt.
      expect(await escrow.contractBalance()).to.equal(TOTAL - MILESTONES[0]);
      expect(await escrow.totalReleased()).to.equal(MILESTONES[0]);
    });

    it('cannot be drained by repeated calls across all milestones', async () => {
      for (let i = 0; i < 3; i++) {
        await escrow.releaseMilestone(projectId, i, ethers.ZeroHash);
      }
      // Everything paid; every repeat attempt fails.
      for (let i = 0; i < 3; i++) {
        await expect(escrow.releaseMilestone(projectId, i, ethers.ZeroHash)).to.be.revertedWithCustomError(
          escrow,
          'MilestoneAlreadyReleased'
        );
      }
      expect(await escrow.contractBalance()).to.equal(0n);
    });

    it('rejects a non-admin caller', async () => {
      await expect(
        escrow.connect(outsider).releaseMilestone(projectId, 0, ethers.ZeroHash)
      ).to.be.revertedWithCustomError(escrow, 'OwnableUnauthorizedAccount');
    });

    it('rejects the contractor releasing their own milestone', async () => {
      // The contractor is the beneficiary, not an approver.
      await expect(
        escrow.connect(contractor).releaseMilestone(projectId, 0, ethers.ZeroHash)
      ).to.be.revertedWithCustomError(escrow, 'OwnableUnauthorizedAccount');
    });

    it('rejects an out-of-range index', async () => {
      await expect(escrow.releaseMilestone(projectId, 3, ethers.ZeroHash))
        .to.be.revertedWithCustomError(escrow, 'MilestoneIndexOutOfRange')
        .withArgs(projectId, 3n);
    });

    it('rejects an unknown project', async () => {
      await expect(escrow.releaseMilestone(99, 0, ethers.ZeroHash))
        .to.be.revertedWithCustomError(escrow, 'ProjectDoesNotExist')
        .withArgs(99n);
    });

    // --- FUNDS CANNOT LEAVE BEFORE THEY ARRIVE ---------------------------
    it('refuses to release from an unfunded project', async () => {
      await escrow.createProject('unfunded-project', otherContractor.address, MILESTONES);
      const unfunded = (await escrow.projectCount()) - 1n;

      await expect(escrow.releaseMilestone(unfunded, 0, ethers.ZeroHash))
        .to.be.revertedWithCustomError(escrow, 'ProjectNotFunded')
        .withArgs(unfunded);
    });

    it('cannot pay one project out of another project\'s funds', async () => {
      // Project A is funded; project B is not. Releasing B must fail even
      // though the contract holds enough ether to cover it.
      await escrow.createProject('project-b', otherContractor.address, MILESTONES);
      const b = (await escrow.projectCount()) - 1n;

      expect(await escrow.contractBalance()).to.equal(TOTAL);
      await expect(escrow.releaseMilestone(b, 0, ethers.ZeroHash)).to.be.revertedWithCustomError(
        escrow,
        'ProjectNotFunded'
      );
      expect(await escrow.contractBalance()).to.equal(TOTAL);
    });
  });

  // =======================================================================
  describe('project completion', () => {
    it('emits ProjectCompleted only on the final milestone', async () => {
      const id = await createFunded();

      await expect(escrow.releaseMilestone(id, 0, ethers.ZeroHash)).to.not.emit(escrow, 'ProjectCompleted');
      await expect(escrow.releaseMilestone(id, 1, ethers.ZeroHash)).to.not.emit(escrow, 'ProjectCompleted');
      await expect(escrow.releaseMilestone(id, 2, ethers.ZeroHash))
        .to.emit(escrow, 'ProjectCompleted')
        .withArgs(id, contractor.address, TOTAL);
    });

    it('fires completion regardless of release order', async () => {
      const id = await createFunded();
      await escrow.releaseMilestone(id, 2, ethers.ZeroHash);
      await escrow.releaseMilestone(id, 0, ethers.ZeroHash);
      await expect(escrow.releaseMilestone(id, 1, ethers.ZeroHash)).to.emit(escrow, 'ProjectCompleted');
    });

    it('pays out exactly the deposit, no more and no less', async () => {
      const id = await createFunded();
      const before = await ethers.provider.getBalance(contractor.address);

      for (let i = 0; i < 3; i++) await escrow.releaseMilestone(id, i, ethers.ZeroHash);

      const after = await ethers.provider.getBalance(contractor.address);
      expect(after - before).to.equal(TOTAL);
      expect(await escrow.contractBalance()).to.equal(0n);
      expect(await escrow.isProjectComplete(id)).to.equal(true);
      expect((await escrow.getProject(id)).remainingAmount).to.equal(0n);
    });
  });

  // =======================================================================
  describe('the admin can never withdraw', () => {
    it('exposes no withdrawal function at all', () => {
      // If a future change adds one, this fails and forces the reviewer to
      // confront the guarantee being removed.
      const names = escrow.interface.fragments
        .filter((f) => f.type === 'function')
        .map((f) => f.name.toLowerCase());

      for (const forbidden of ['withdraw', 'sweep', 'refund', 'drain', 'emergencywithdraw', 'rescue']) {
        expect(names).to.not.include(forbidden);
      }
    });

    it('rejects a plain transfer into the contract', async () => {
      // No receive/fallback: ether arriving outside lockFunds would belong to
      // no project and could never be released, so it is refused at the door.
      await expect(admin.sendTransaction({ to: await escrow.getAddress(), value: eth('1') })).to.be.revert(
        ethers
      );
    });

    it('sends money only to the project contractor', async () => {
      const id = await createFunded();
      const adminBefore = await ethers.provider.getBalance(admin.address);
      const outsiderBefore = await ethers.provider.getBalance(outsider.address);

      await escrow.releaseMilestone(id, 0, ethers.ZeroHash);

      // The admin only ever loses gas; the outsider is untouched.
      expect(await ethers.provider.getBalance(admin.address)).to.be.lessThan(adminBefore);
      expect(await ethers.provider.getBalance(outsider.address)).to.equal(outsiderBefore);
    });
  });

  // =======================================================================
  describe('admin transfer', () => {
    it('lets ownership move to a new admin wallet', async () => {
      const id = await createFunded();
      await escrow.transferOwnership(outsider.address);
      expect(await escrow.owner()).to.equal(outsider.address);

      // The new admin can release; the old one cannot.
      await expect(escrow.releaseMilestone(id, 0, ethers.ZeroHash)).to.be.revertedWithCustomError(
        escrow,
        'OwnableUnauthorizedAccount'
      );
      await escrow.connect(outsider).releaseMilestone(id, 0, ethers.ZeroHash);
      expect(await escrow.isMilestoneReleased(id, 0)).to.equal(true);
    });

    it('rejects a non-admin transferring ownership', async () => {
      await expect(
        escrow.connect(outsider).transferOwnership(outsider.address)
      ).to.be.revertedWithCustomError(escrow, 'OwnableUnauthorizedAccount');
    });
  });

  // =======================================================================
  describe('views', () => {
    it('reverts rather than returning empty data for an unknown project', async () => {
      for (const call of [
        escrow.getProject(42),
        escrow.getMilestones(42),
        escrow.remainingFunds(42),
        escrow.isProjectComplete(42),
        escrow.getMilestone(42, 0),
        escrow.isMilestoneReleased(42, 0),
      ]) {
        await expect(call).to.be.revertedWithCustomError(escrow, 'ProjectDoesNotExist');
      }
    });

    it('reports zero remaining for a created-but-unfunded project', async () => {
      await escrow.createProject(OFF_CHAIN_ID, contractor.address, MILESTONES);
      expect(await escrow.remainingFunds(0)).to.equal(0n);
      expect(await escrow.isProjectComplete(0)).to.equal(false);
    });

    it('keeps the ledger balanced across several projects', async () => {
      await escrow.createAndFundProject('p1', contractor.address, MILESTONES, { value: TOTAL });
      await escrow.createAndFundProject('p2', otherContractor.address, [eth('0.5'), eth('0.5')], {
        value: eth('1'),
      });

      await escrow.releaseMilestone(0, 0, ethers.ZeroHash);
      await escrow.releaseMilestone(1, 1, ethers.ZeroHash);

      const escrowed = await escrow.totalEscrowed();
      const released = await escrow.totalReleased();

      expect(escrowed).to.equal(eth('2'));
      expect(released).to.equal(MILESTONES[0] + eth('0.5'));
      // The invariant that matters: the contract holds exactly what it owes.
      expect(await escrow.contractBalance()).to.equal(escrowed - released);
    });

    it('isolates projects from each other', async () => {
      await escrow.createAndFundProject('p1', contractor.address, MILESTONES, { value: TOTAL });
      await escrow.createAndFundProject('p2', otherContractor.address, MILESTONES, { value: TOTAL });

      await escrow.releaseMilestone(0, 0, ethers.ZeroHash);

      expect((await escrow.getProject(0)).releasedAmount).to.equal(MILESTONES[0]);
      expect((await escrow.getProject(1)).releasedAmount).to.equal(0n);
      expect(await escrow.isMilestoneReleased(1, 0)).to.equal(false);
    });

    it('pays each project\'s own contractor', async () => {
      await escrow.createAndFundProject('p1', contractor.address, MILESTONES, { value: TOTAL });
      await escrow.createAndFundProject('p2', otherContractor.address, MILESTONES, { value: TOTAL });

      const cBefore = await ethers.provider.getBalance(contractor.address);
      const oBefore = await ethers.provider.getBalance(otherContractor.address);

      await escrow.releaseMilestone(1, 0, ethers.ZeroHash);

      expect(await ethers.provider.getBalance(contractor.address)).to.equal(cBefore);
      expect(await ethers.provider.getBalance(otherContractor.address)).to.equal(oBefore + MILESTONES[0]);
    });
  });

  // =======================================================================
  describe('reentrancy', () => {
    it('survives a contractor that re-enters on payment', async () => {
      // A malicious contractor calls back into releaseMilestone from its
      // receive hook. The milestone is already marked Released before the
      // transfer, so the reentrant call finds nothing to pay — and
      // nonReentrant blocks it regardless.
      const Attacker = await ethers.getContractFactory('ReentrantContractor');
      const attacker = await Attacker.deploy(await escrow.getAddress());
      await attacker.waitForDeployment();

      await escrow.createAndFundProject('attack', await attacker.getAddress(), MILESTONES, { value: TOTAL });
      const id = (await escrow.projectCount()) - 1n;

      // The attacker's receive() reverts the whole transfer when it re-enters,
      // so either the release fails outright or it succeeds exactly once.
      // Both are safe; what must never happen is more than one payout.
      try {
        await escrow.releaseMilestone(id, 0, ethers.ZeroHash);
      } catch {
        /* a revert here is an acceptable outcome */
      }

      const balance = await ethers.provider.getBalance(await attacker.getAddress());
      expect(balance).to.be.lessThanOrEqual(MILESTONES[0]);
      expect(await escrow.totalReleased()).to.be.lessThanOrEqual(MILESTONES[0]);
      // Whatever happened, the contract still holds what it owes.
      expect(await escrow.contractBalance()).to.equal(
        (await escrow.totalEscrowed()) - (await escrow.totalReleased())
      );
    });
  });

  // =======================================================================
  describe('realistic end-to-end flow', () => {
    it('runs a 4-stage project from award to completion', async () => {
      // 20% / 30% / 30% / 20% of 2.5 ETH, as an admin would define on award.
      const total = eth('2.5');
      const schedule = [eth('0.5'), eth('0.75'), eth('0.75'), eth('0.5')];
      const dbId = '6ac3f778cda32cb3e1623f44';

      await escrow.createAndFundProject(dbId, contractor.address, schedule, { value: total });
      const [, id] = await escrow.projectIdForOffChainId(dbId);

      expect((await escrow.getProject(id)).remainingAmount).to.equal(total);

      const start = await ethers.provider.getBalance(contractor.address);
      let paid = 0n;

      for (let i = 0; i < schedule.length; i++) {
        const evidence = ethers.keccak256(ethers.toUtf8Bytes(`${dbId}:milestone:${i}`));
        await escrow.releaseMilestone(id, i, evidence);
        paid += schedule[i];

        const p = await escrow.getProject(id);
        expect(p.releasedAmount).to.equal(paid);
        expect(p.remainingAmount).to.equal(total - paid);
        expect(p.completed).to.equal(i === schedule.length - 1);
      }

      expect((await ethers.provider.getBalance(contractor.address)) - start).to.equal(total);
      expect(await escrow.contractBalance()).to.equal(0n);
      expect(await escrow.isProjectComplete(id)).to.equal(true);
    });
  });

  // =======================================================================
  describe('payment through a batching smart account', () => {
    /**
     * The scenario that broke the backend in live testing.
     *
     * MetaMask's smart-account batching (EIP-7702) routes the call through a
     * delegation contract, so the transaction's `to` is that contract and not
     * the escrow. The backend required `receipt.to` to be the escrow and so
     * rejected a real payment: the funds had moved, the escrow had emitted
     * MilestoneReleased, and the platform refused to record it.
     *
     * These pin the on-chain facts the fix relies on.
     */
    let smartAccount;
    let id;

    beforeEach(async () => {
      const Factory = await ethers.getContractFactory('BatchingSmartAccount');
      smartAccount = await Factory.deploy(await escrow.getAddress());
      await smartAccount.waitForDeployment();

      id = await createFunded();

      // The delegation contract acts with the owner's authority, so it must
      // hold ownership for the release to pass `onlyOwner` — mirroring a
      // delegated account acting as the user.
      await escrow.transferOwnership(await smartAccount.getAddress());
    });

    it('pays the contractor even though the escrow is not the transaction target', async () => {
      const before = await ethers.provider.getBalance(contractor.address);

      const tx = await smartAccount.releaseOne(id, 0, ethers.ZeroHash);
      const receipt = await tx.wait();

      // The receipt points at the smart account, NOT the escrow.
      expect(receipt.to).to.equal(await smartAccount.getAddress());
      expect(receipt.to).to.not.equal(await escrow.getAddress());

      // The money still moved.
      expect((await ethers.provider.getBalance(contractor.address)) - before).to.equal(
        MILESTONES[0]
      );
    });

    it('still emits MilestoneReleased from the escrow address itself', async () => {
      // This is what makes verification-by-emitter correct: the escrow is the
      // emitter even when it is not the recipient.
      const tx = await smartAccount.releaseOne(id, 1, ethers.ZeroHash);
      const receipt = await tx.wait();

      const escrowAddress = await escrow.getAddress();
      const fromEscrow = receipt.logs.filter(
        (log) => log.address.toLowerCase() === escrowAddress.toLowerCase()
      );

      expect(fromEscrow).to.have.lengthOf(1);
      const parsed = escrow.interface.parseLog(fromEscrow[0]);
      expect(parsed.name).to.equal('MilestoneReleased');
      expect(parsed.args.projectId).to.equal(id);
      expect(parsed.args.milestoneIndex).to.equal(1n);
      expect(parsed.args.contractor).to.equal(contractor.address);
      expect(parsed.args.amount).to.equal(MILESTONES[1]);
    });

    it('carries the evidence hash through the intermediary unchanged', async () => {
      // The evidence hash ties the payment to the approval record, so it must
      // survive being relayed.
      const evidence = ethers.keccak256(ethers.toUtf8Bytes('approval record for milestone 1'));

      await expect(smartAccount.releaseOne(id, 0, evidence))
        .to.emit(escrow, 'MilestoneReleased')
        .withArgs(id, 0n, contractor.address, MILESTONES[0], evidence);
    });

    it('emits one escrow event per milestone when several are batched', async () => {
      // A batch is a single transaction with several releases, so a verifier
      // that assumes one event per transaction would mis-read it.
      const tx = await smartAccount.releaseMany(id, [0, 1, 2], ethers.ZeroHash);
      const receipt = await tx.wait();

      const escrowAddress = await escrow.getAddress();
      const released = receipt.logs
        .filter((log) => log.address.toLowerCase() === escrowAddress.toLowerCase())
        .map((log) => escrow.interface.parseLog(log))
        .filter((e) => e.name === 'MilestoneReleased');

      expect(released).to.have.lengthOf(3);
      expect(released.map((e) => e.args.milestoneIndex)).to.deep.equal([0n, 1n, 2n]);

      // And the project is settled exactly once, with nothing left over.
      expect(await escrow.isProjectComplete(id)).to.equal(true);
      expect(await escrow.contractBalance()).to.equal(0n);
    });

    it('cannot pay a milestone twice, even batched in one transaction', async () => {
      // Batching must not become a way around the double-payment guard.
      await expect(smartAccount.releaseMany(id, [0, 0], ethers.ZeroHash)).to.be.revertedWithCustomError(
        escrow,
        'MilestoneAlreadyReleased'
      );

      // The whole transaction reverted, so not even the first release stands.
      const milestones = await escrow.getMilestones(id);
      expect(milestones[0].status).to.equal(0n);
      expect(await escrow.contractBalance()).to.equal(TOTAL);
    });

    it('does not let an unauthorised intermediary release anything', async () => {
      // A relayer is not a licence. Ownership was moved to `smartAccount`, so a
      // second, unowned one must still be refused.
      const Factory = await ethers.getContractFactory('BatchingSmartAccount');
      const rogue = await Factory.deploy(await escrow.getAddress());
      await rogue.waitForDeployment();

      await expect(rogue.releaseOne(id, 0, ethers.ZeroHash)).to.be.revertedWithCustomError(
        escrow,
        'OwnableUnauthorizedAccount'
      );
    });
  });
});
