/**
 * One template per event.
 *
 * Keyed by the same event names the notification service already dispatches,
 * so adding an event is: add a hook there, add a renderer here. A missing
 * template is caught by a test rather than discovered as a blank email.
 *
 * Each renderer returns { html, text }. Tone is plain and factual: these go to
 * citizens who reported a pothole, not to users of a product.
 */
import {
  wrap,
  heading,
  paragraph,
  paragraphRaw,
  factTable,
  button,
  badge,
  quote,
  bullets,
  onChainProof,
  money,
  eth,
  textBlock,
  textFacts,
  TEXT_FOOTER,
  BRAND,
} from './layout.js';

const greet = (name) => `Hello ${name || 'there'},`;

/** Shorthand for the common shape: greeting, prose, facts, call to action. */
const page = ({ title, preheader, name, intro, badgeText, badgeTone, blocks = [], cta, footerNote }) => {
  const body = [
    badgeText ? `<div style="margin:0 0 14px;">${badge(badgeText, badgeTone)}</div>` : '',
    heading(title),
    paragraph(greet(name)),
    ...(Array.isArray(intro) ? intro.map(paragraph) : [paragraph(intro)]),
    ...blocks,
    cta ? button(cta.label, cta.href) : '',
  ].join('\n');

  return wrap({ title, preheader, body, footerNote });
};

export const TEMPLATES = {
  // =======================================================================
  // Phase 3 — reporting
  // =======================================================================

  'report.received': (d) => ({
    html: page({
      title: 'We received your report',
      preheader: `Estimated repair cost ${money(d.estimatedCost, d.currency)}. An official will review it shortly.`,
      name: d.name,
      badgeText: 'Under review',
      badgeTone: 'info',
      intro:
        'Thank you for reporting this. Our AI has reviewed your photo, confirmed it shows public infrastructure, and produced an independent estimate of what the repair should cost.',
      blocks: [
        factTable([
          ['Reference', d.reportId],
          ['Location', d.location],
          ['Problem', d.description],
          ['Severity', d.severity],
          ['Estimated cost', money(d.estimatedCost, d.currency)],
        ]),
        paragraph(
          'That estimate matters: when contractors bid for this work, any bid significantly above it is automatically flagged for scrutiny.'
        ),
      ],
      cta: { label: 'Track your report', href: d.link },
    }),
    text: textBlock([
      greet(d.name),
      '',
      'Thank you for reporting this. Our AI has reviewed your photo, confirmed it shows',
      'public infrastructure, and produced an independent estimate of the repair cost.',
      '',
      textFacts([
        ['Reference', d.reportId],
        ['Location', d.location],
        ['Severity', d.severity],
        ['Estimated cost', money(d.estimatedCost, d.currency)],
      ]),
      '',
      'When contractors bid for this work, any bid significantly above that estimate is',
      'automatically flagged for scrutiny.',
      '',
      `Track your report: ${d.link}`,
      TEXT_FOOTER,
    ]),
  }),

  'report.rejected': (d) => ({
    html: page({
      title: 'About the photo you submitted',
      preheader: 'We could not accept this photo as an infrastructure report.',
      name: d.name,
      badgeText: 'Not accepted',
      badgeTone: 'danger',
      intro:
        'We reviewed the photo you sent, but could not accept it as a report of a public infrastructure problem. Here is what our automated review found:',
      blocks: [
        quote(d.reason),
        paragraph(
          'If you believe this is a genuine infrastructure problem, you are welcome to submit a clearer photo — ideally taken in daylight, from a few steps back, showing the damage and its surroundings.'
        ),
      ],
      cta: { label: 'Submit another report', href: d.link },
      footerNote: 'An official can review this decision if you think it is wrong.',
    }),
    text: textBlock([
      greet(d.name),
      '',
      'We reviewed the photo you sent, but could not accept it as a report of a public',
      'infrastructure problem. Our automated review found:',
      '',
      `  "${d.reason}"`,
      '',
      'If you believe this is a genuine infrastructure problem, please submit a clearer',
      'photo — ideally in daylight, from a few steps back, showing the damage and its',
      'surroundings. An official can also review this decision.',
      '',
      `Submit another report: ${d.link}`,
      TEXT_FOOTER,
    ]),
  }),

  'report.awaiting_review': (d) => ({
    html: page({
      title: 'A new report needs review',
      preheader: `${d.location ?? 'New report'} — estimated ${money(d.estimatedCost, d.currency)}`,
      name: d.name,
      badgeText: 'Action needed',
      badgeTone: 'warning',
      intro: 'A citizen report has passed the automated relevance check and is waiting for your decision.',
      blocks: [
        factTable([
          ['Reference', d.reportId],
          ['Location', d.location],
          ['Severity', d.severity],
          ['AI estimate', money(d.estimatedCost, d.currency)],
        ]),
      ],
      cta: { label: 'Review this report', href: d.link },
    }),
    text: textBlock([
      greet(d.name),
      '',
      'A citizen report has passed the automated relevance check and awaits your decision.',
      '',
      textFacts([
        ['Reference', d.reportId],
        ['Location', d.location],
        ['Severity', d.severity],
        ['AI estimate', money(d.estimatedCost, d.currency)],
      ]),
      '',
      `Review: ${d.link}`,
      TEXT_FOOTER,
    ]),
  }),

  // =======================================================================
  // Phase 4 — review & publication
  // =======================================================================

  'report.approved': (d) => ({
    html: page({
      title: 'Your report has been approved',
      preheader: 'An official has approved your report. It will be published for contractors to bid on.',
      name: d.name,
      badgeText: 'Approved',
      badgeTone: 'success',
      intro:
        'An official has reviewed and approved your report. It will now be published as a public project that licensed contractors can bid to carry out.',
      blocks: [
        factTable([
          ['Reference', d.reportId],
          ['Location', d.location],
          [
            'Assessed cost',
            d.estimate ? `${money(d.estimate.min, d.estimate.currency)} – ${money(d.estimate.max, d.estimate.currency)}` : null,
          ],
        ]),
        paragraph(
          'You will be told when the work is awarded, and again each time a stage of the work is verified and paid for.'
        ),
      ],
      cta: { label: 'View your report', href: d.link },
    }),
    text: textBlock([
      greet(d.name),
      '',
      'An official has reviewed and approved your report. It will now be published as a',
      'public project that contractors can bid to carry out.',
      '',
      textFacts([
        ['Reference', d.reportId],
        ['Location', d.location],
        [
          'Assessed cost',
          d.estimate ? `${money(d.estimate.min, d.estimate.currency)} - ${money(d.estimate.max, d.estimate.currency)}` : null,
        ],
      ]),
      '',
      'You will be told when the work is awarded, and each time a stage is verified and paid.',
      '',
      `View your report: ${d.link}`,
      TEXT_FOOTER,
    ]),
  }),

  'report.rejected_by_admin': (d) => ({
    html: page({
      title: 'An update on your report',
      preheader: 'An official has reviewed your report and was unable to take it forward.',
      name: d.name,
      badgeText: 'Not taken forward',
      badgeTone: 'danger',
      intro: 'An official has reviewed your report and was unable to take it forward. Their reason:',
      blocks: [
        quote(d.reason),
        paragraph(
          'Thank you for taking the time to report it. If circumstances change, or if you have more information, you are welcome to report it again.'
        ),
      ],
      cta: { label: 'View your report', href: d.link },
    }),
    text: textBlock([
      greet(d.name),
      '',
      'An official has reviewed your report and was unable to take it forward. Their reason:',
      '',
      `  "${d.reason}"`,
      '',
      'Thank you for taking the time to report it. If circumstances change, you are welcome',
      'to report it again.',
      '',
      `View your report: ${d.link}`,
      TEXT_FOOTER,
    ]),
  }),

  'project.published': (d) => ({
    html: page({
      title: 'Your report is now an open public project',
      preheader: 'Contractors can now bid to carry out the repair you reported.',
      name: d.name,
      badgeText: 'Open for bidding',
      badgeTone: 'info',
      intro:
        'The problem you reported is now a public project. Contractors can bid to carry out the work, and every bid is measured against the independent cost assessment.',
      blocks: [
        factTable([
          ['Project', d.title],
          [
            'Assessed cost',
            `${money(d.estimate.min, d.estimate.currency)} – ${money(d.estimate.max, d.estimate.currency)}`,
          ],
          ['Most likely', money(d.estimate.expected, d.estimate.currency)],
        ]),
        paragraph('Anyone can follow this project — including the money — without signing in.'),
      ],
      cta: { label: 'Follow this project publicly', href: d.link },
    }),
    text: textBlock([
      greet(d.name),
      '',
      'The problem you reported is now a public project. Contractors can bid to carry out',
      'the work, and every bid is measured against the independent cost assessment.',
      '',
      textFacts([
        ['Project', d.title],
        [
          'Assessed cost',
          `${money(d.estimate.min, d.estimate.currency)} - ${money(d.estimate.max, d.estimate.currency)}`,
        ],
      ]),
      '',
      `Follow this project publicly: ${d.link}`,
      TEXT_FOOTER,
    ]),
  }),

  'project.open_for_bids': (d) => ({
    html: page({
      title: 'New project open for bidding',
      preheader: `${d.title} — assessed up to ${money(d.estimate.max, d.estimate.currency)}`,
      name: d.name,
      badgeText: 'Open for bids',
      badgeTone: 'info',
      intro: 'A new public infrastructure project is open for bidding.',
      blocks: [
        factTable([
          ['Project', d.title],
          ['Location', d.location],
          [
            'Assessed cost',
            `${money(d.estimate.min, d.estimate.currency)} – ${money(d.estimate.max, d.estimate.currency)}`,
          ],
          ['Bids close', d.bidsCloseAt ? new Date(d.bidsCloseAt).toUTCString() : 'No deadline set'],
        ]),
        paragraphRaw(
          `Bids above <strong>${money(d.estimate.max, d.estimate.currency)}</strong> by more than 20% are automatically flagged for scrutiny. The assessment and its assumptions are shown on the project page.`
        ),
      ],
      cta: { label: 'View project and bid', href: d.link },
    }),
    text: textBlock([
      greet(d.name),
      '',
      'A new public infrastructure project is open for bidding.',
      '',
      textFacts([
        ['Project', d.title],
        ['Location', d.location],
        [
          'Assessed cost',
          `${money(d.estimate.min, d.estimate.currency)} - ${money(d.estimate.max, d.estimate.currency)}`,
        ],
        ['Bids close', d.bidsCloseAt ? new Date(d.bidsCloseAt).toUTCString() : 'No deadline set'],
      ]),
      '',
      `Bids more than 20% above ${money(d.estimate.max, d.estimate.currency)} are automatically flagged.`,
      '',
      `View project and bid: ${d.link}`,
      TEXT_FOOTER,
    ]),
  }),

  // =======================================================================
  // Phase 5 — bidding & award
  // =======================================================================

  'bid.submitted': (d) => ({
    html: page({
      title: d.flagged ? 'Bid received — and flagged for review' : 'Bid received',
      preheader: d.flagged
        ? 'Your bid exceeds the assessed cost range and has been flagged.'
        : `Your bid of ${money(d.bid.amount, d.bid.currency)} has been recorded.`,
      name: d.name,
      badgeText: d.flagged ? 'Flagged' : 'Submitted',
      badgeTone: d.flagged ? 'warning' : 'info',
      intro: d.flagged
        ? 'Your bid has been recorded, but it exceeds the independent cost assessment for this project and has been flagged for the reviewing official.'
        : 'Your bid has been recorded and will be considered alongside the others.',
      blocks: [
        factTable([
          ['Project', d.title],
          ['Your bid', money(d.bid.amount, d.bid.currency)],
        ]),
        d.flagged && d.anomalyExplanation ? quote(d.anomalyExplanation) : '',
        d.flagged
          ? paragraph(
              'A flag is not a rejection. If there are site conditions the assessment could not see from a photograph, say so in your proposal — officials can and do award flagged bids when the reasoning holds up.'
            )
          : '',
      ],
      cta: { label: 'View your bid', href: d.link },
    }),
    text: textBlock([
      greet(d.name),
      '',
      d.flagged
        ? 'Your bid has been recorded, but it exceeds the independent cost assessment for\nthis project and has been flagged for the reviewing official.'
        : 'Your bid has been recorded and will be considered alongside the others.',
      '',
      textFacts([
        ['Project', d.title],
        ['Your bid', money(d.bid.amount, d.bid.currency)],
      ]),
      '',
      d.flagged && d.anomalyExplanation ? `  "${d.anomalyExplanation}"\n` : '',
      d.flagged
        ? 'A flag is not a rejection. If there are site conditions the assessment could not\nsee from a photograph, say so in your proposal.'
        : '',
      '',
      `View your bid: ${d.link}`,
      TEXT_FOOTER,
    ]),
  }),

  'bid.received': (d) => ({
    html: page({
      title: 'New bid received',
      preheader: `${d.contractorName} bid ${money(d.bid.amount, d.bid.currency)} on ${d.title}`,
      name: d.name,
      badgeText: d.band === 'none' ? 'Within assessment' : d.band,
      badgeTone: d.band === 'none' ? 'success' : d.band === 'elevated' ? 'warning' : 'danger',
      intro: 'A contractor has bid on a project you published.',
      blocks: [
        factTable([
          ['Project', d.title],
          ['Contractor', d.contractorName],
          ['Bid', money(d.bid.amount, d.bid.currency)],
          ['Assessed upper bound', money(d.benchmark.amount, d.benchmark.currency)],
          ['Assessment band', d.band],
        ]),
      ],
      cta: { label: 'Review all bids', href: d.link },
    }),
    text: textBlock([
      greet(d.name),
      '',
      'A contractor has bid on a project you published.',
      '',
      textFacts([
        ['Project', d.title],
        ['Contractor', d.contractorName],
        ['Bid', money(d.bid.amount, d.bid.currency)],
        ['Assessed upper bound', money(d.benchmark.amount, d.benchmark.currency)],
        ['Band', d.band],
      ]),
      '',
      `Review all bids: ${d.link}`,
      TEXT_FOOTER,
    ]),
  }),

  'bid.flagged': (d) => ({
    html: page({
      title: 'Anomalous bid flagged',
      preheader: `${d.contractorName}'s bid is ${d.deviationPercent}% above the assessed upper bound.`,
      name: d.name,
      badgeText: d.band === 'severe' ? 'Severe' : 'Flagged',
      badgeTone: 'danger',
      intro:
        'A bid has exceeded the independent cost assessment by more than the permitted margin and has been flagged for your attention.',
      blocks: [
        factTable([
          ['Project', d.title],
          ['Contractor', d.contractorName],
          ['Bid', money(d.bid.amount, d.bid.currency)],
          ['Assessed upper bound', money(d.benchmark.amount, d.benchmark.currency)],
          ['Flag threshold', money(d.threshold.amount, d.threshold.currency)],
          ['Above upper bound by', `${d.deviationPercent}%`],
        ]),
        d.explanation ? quote(d.explanation) : '',
        paragraph(
          'You can still award this bid if the contractor has given good reason. The flag and your decision are both part of the public record.'
        ),
      ],
      cta: { label: 'Review all bids', href: d.link },
      footerNote: 'Flags compare bids against the generous end of the assessed range, not the midpoint.',
    }),
    text: textBlock([
      greet(d.name),
      '',
      'A bid has exceeded the independent cost assessment by more than the permitted',
      'margin and has been flagged for your attention.',
      '',
      textFacts([
        ['Project', d.title],
        ['Contractor', d.contractorName],
        ['Bid', money(d.bid.amount, d.bid.currency)],
        ['Assessed upper bound', money(d.benchmark.amount, d.benchmark.currency)],
        ['Flag threshold', money(d.threshold.amount, d.threshold.currency)],
        ['Above upper bound by', `${d.deviationPercent}%`],
      ]),
      '',
      d.explanation ? `  "${d.explanation}"\n` : '',
      'You can still award this bid if the contractor has given good reason. Both the flag',
      'and your decision are part of the public record.',
      '',
      `Review all bids: ${d.link}`,
      TEXT_FOOTER,
    ]),
  }),

  'project.awarded': (d) => ({
    html: page({
      title: 'You have been awarded this project',
      preheader: `${d.title} — ${money(d.awarded.amount, d.awarded.currency)}`,
      name: d.name,
      badgeText: 'Awarded',
      badgeTone: 'success',
      intro:
        'Your bid has been accepted. The agreed funds are being placed in an escrow contract, and will be released to you stage by stage as each part of the work is verified.',
      blocks: [
        factTable([
          ['Project', d.title],
          ['Agreed amount', money(d.awarded.amount, d.awarded.currency)],
          ['Payout wallet', d.walletAddress],
        ]),
        paragraph(
          'For each stage you will upload a photograph of the completed work. It is checked automatically, then by an official, and the payment for that stage is released on the public blockchain.'
        ),
      ],
      cta: { label: 'View the project', href: d.link },
      footerNote: 'Payments can only go to the wallet above. Contact an official if it is wrong.',
    }),
    text: textBlock([
      greet(d.name),
      '',
      'Your bid has been accepted. The agreed funds are being placed in an escrow',
      'contract and will be released stage by stage as the work is verified.',
      '',
      textFacts([
        ['Project', d.title],
        ['Agreed amount', money(d.awarded.amount, d.awarded.currency)],
        ['Payout wallet', d.walletAddress],
      ]),
      '',
      'For each stage, upload a photo of the completed work. It is checked automatically,',
      'then by an official, and that stage’s payment is released on the public blockchain.',
      '',
      `View the project: ${d.link}`,
      TEXT_FOOTER,
    ]),
  }),

  'bid.not_selected': (d) => ({
    html: page({
      title: 'Outcome of your bid',
      preheader: `${d.title} has been awarded to another contractor.`,
      name: d.name,
      badgeText: 'Not selected',
      badgeTone: 'neutral',
      intro: `Thank you for bidding on ${d.title}. On this occasion the work has been awarded to another contractor.`,
      blocks: [
        factTable([
          ['Project', d.title],
          ['Your bid', money(d.bid.amount, d.bid.currency)],
        ]),
        paragraph(
          'The award and the winning amount are published on the transparency dashboard, so you can see what the work was awarded for.'
        ),
      ],
      cta: { label: 'See other open projects', href: d.link },
    }),
    text: textBlock([
      greet(d.name),
      '',
      `Thank you for bidding on ${d.title}. On this occasion the work has been awarded to`,
      'another contractor.',
      '',
      textFacts([['Your bid', money(d.bid.amount, d.bid.currency)]]),
      '',
      'The award and winning amount are published on the transparency dashboard.',
      '',
      `See other open projects: ${d.link}`,
      TEXT_FOOTER,
    ]),
  }),

  'project.awarded_reporter': (d) => ({
    html: page({
      title: 'Work has been commissioned for your report',
      preheader: `A contractor has been appointed for ${d.title}.`,
      name: d.name,
      badgeText: 'Contractor appointed',
      badgeTone: 'success',
      intro:
        'A contractor has been appointed to fix the problem you reported. The agreed funds are held in escrow and released only as each stage of work is verified.',
      blocks: [
        factTable([
          ['Project', d.title],
          ['Agreed amount', money(d.awarded.amount, d.awarded.currency)],
        ]),
        paragraph('You will be emailed each time a stage is verified and paid, with a link to the payment record.'),
      ],
      cta: { label: 'Follow the money trail', href: d.link },
    }),
    text: textBlock([
      greet(d.name),
      '',
      'A contractor has been appointed to fix the problem you reported. The agreed funds',
      'are held in escrow and released only as each stage of work is verified.',
      '',
      textFacts([
        ['Project', d.title],
        ['Agreed amount', money(d.awarded.amount, d.awarded.currency)],
      ]),
      '',
      'You will be emailed each time a stage is verified and paid, with a link to the',
      'payment record.',
      '',
      `Follow the money trail: ${d.link}`,
      TEXT_FOOTER,
    ]),
  }),

  // =======================================================================
  // Phase 7 — escrow, milestones, payment
  // =======================================================================

  'escrow.funded': (d) => ({
    html: page({
      title: 'Funds are now in escrow',
      preheader: `The escrow for ${d.title} has been funded. You can start submitting progress.`,
      name: d.name,
      badgeText: 'Escrow funded',
      badgeTone: 'success',
      intro:
        'The funds for this project are now locked in the escrow contract. They cannot be withdrawn by anyone — they can only be released to you, stage by stage, as the work is verified.',
      blocks: [
        factTable([['Project', d.title]]),
        onChainProof({
          transactionHash: d.transactionHash,
          explorerUrl: d.explorerUrl,
          note: 'The deposit transaction that locked the funds.',
        }),
      ],
      cta: { label: 'Start submitting progress', href: d.link },
    }),
    text: textBlock([
      greet(d.name),
      '',
      'The funds for this project are now locked in the escrow contract. They cannot be',
      'withdrawn by anyone — only released to you, stage by stage, as work is verified.',
      '',
      textFacts([
        ['Project', d.title],
        ['Deposit transaction', d.transactionHash],
      ]),
      '',
      `Verify on Etherscan: ${d.explorerUrl}`,
      '',
      `Start submitting progress: ${d.link}`,
      TEXT_FOOTER,
    ]),
  }),

  'milestone.submitted': (d) => ({
    html: page({
      title: `Milestone ${d.milestoneNumber} awaits your approval`,
      preheader: `${d.contractorName} submitted stage ${d.milestoneNumber} of ${d.title}. The AI check passed.`,
      name: d.name,
      badgeText: 'Approval needed',
      badgeTone: 'warning',
      intro:
        'A contractor has submitted photographic evidence for a stage of work, and the automated check is satisfied it looks complete. Your approval will release that stage’s funds on the blockchain.',
      blocks: [
        factTable([
          ['Project', d.title],
          ['Contractor', d.contractorName],
          ['Stage', `${d.milestoneNumber} — ${d.milestoneDescription}`],
          ['Share of funds', `${d.fundPercentage}%`],
          ['AI confidence', d.aiConfidence !== undefined ? `${Math.round(d.aiConfidence * 100)}%` : null],
          ['Assessed quality', d.workQuality],
        ]),
        d.aiAssessment ? quote(d.aiAssessment) : '',
        d.progressImageUrl
          ? paragraphRaw(
              `<a href="${d.progressImageUrl}" style="color:${BRAND.accent};font-weight:600;">View the progress photograph</a>`
            )
          : '',
        paragraph('Releasing funds is irreversible, so please satisfy yourself the work is genuinely done.'),
      ],
      cta: { label: 'Review and approve', href: d.link },
    }),
    text: textBlock([
      greet(d.name),
      '',
      'A contractor has submitted evidence for a stage of work and the automated check is',
      'satisfied it looks complete. Your approval will release that stage’s funds on-chain.',
      '',
      textFacts([
        ['Project', d.title],
        ['Contractor', d.contractorName],
        ['Stage', `${d.milestoneNumber} - ${d.milestoneDescription}`],
        ['Share of funds', `${d.fundPercentage}%`],
        ['AI confidence', d.aiConfidence !== undefined ? `${Math.round(d.aiConfidence * 100)}%` : null],
      ]),
      '',
      d.aiAssessment ? `  "${d.aiAssessment}"\n` : '',
      d.progressImageUrl ? `Progress photo: ${d.progressImageUrl}\n` : '',
      'Releasing funds is irreversible, so please satisfy yourself the work is genuinely done.',
      '',
      `Review and approve: ${d.link}`,
      TEXT_FOOTER,
    ]),
  }),

  'milestone.ai_rejected': (d) => ({
    html: page({
      title: `Milestone ${d.milestoneNumber} needs another photograph`,
      preheader: 'Our automated check could not confirm this stage is complete.',
      name: d.name,
      badgeText: 'Resubmission needed',
      badgeTone: 'warning',
      intro:
        'Thank you for the update. Our automated check could not confirm this stage is complete, so it has not gone forward for approval yet. Here is what it found:',
      blocks: [
        d.assessment ? quote(d.assessment) : '',
        d.concerns?.length ? paragraph('Specifically:') : '',
        bullets(d.concerns),
        d.matchesOriginalIssue === false
          ? paragraph(
              'The photograph also did not appear to show the same location as the original report. Please photograph the site named in the project.'
            )
          : '',
        paragraph(
          'You can submit another photograph at any time. A clear daylight shot from a few steps back, showing the finished work and its surroundings, is usually enough.'
        ),
      ],
      cta: { label: 'Submit another photograph', href: d.link },
      footerNote: 'If you believe the work is complete, an official can review it directly.',
    }),
    text: textBlock([
      greet(d.name),
      '',
      'Our automated check could not confirm this stage is complete, so it has not gone',
      'forward for approval yet. What it found:',
      '',
      d.assessment ? `  "${d.assessment}"\n` : '',
      d.concerns?.length ? d.concerns.map((c) => `  - ${c}`).join('\n') : '',
      '',
      d.matchesOriginalIssue === false
        ? 'The photograph also did not appear to show the same location as the original report.\n'
        : '',
      'You can submit another photograph at any time. A clear daylight shot from a few',
      'steps back, showing the finished work and its surroundings, is usually enough.',
      'If you believe the work is complete, an official can review it directly.',
      '',
      `Submit another photograph: ${d.link}`,
      TEXT_FOOTER,
    ]),
  }),

  'milestone.rejected': (d) => ({
    html: page({
      title: `Milestone ${d.milestoneNumber} was not approved`,
      preheader: 'An official has reviewed this stage and asked for more work.',
      name: d.name,
      badgeText: 'Not approved',
      badgeTone: 'danger',
      intro: 'An official has reviewed this stage of work and was unable to approve it. Their reason:',
      blocks: [
        quote(d.reason),
        paragraph('Once addressed, submit a new photograph and it will be reviewed again.'),
      ],
      cta: { label: 'Submit another photograph', href: d.link },
    }),
    text: textBlock([
      greet(d.name),
      '',
      'An official has reviewed this stage of work and was unable to approve it. Their reason:',
      '',
      `  "${d.reason}"`,
      '',
      'Once addressed, submit a new photograph and it will be reviewed again.',
      '',
      `Submit another photograph: ${d.link}`,
      TEXT_FOOTER,
    ]),
  }),

  'milestone.paid.contractor': (d) => ({
    html: page({
      title: `Payment released for milestone ${d.milestoneNumber}`,
      preheader: `${eth(d.amountWei)} has been sent to your wallet and recorded on the blockchain.`,
      name: d.name,
      badgeText: 'Paid',
      badgeTone: 'success',
      intro: 'This stage of work has been approved and its funds have been released to your wallet.',
      blocks: [
        factTable([
          ['Project', d.title],
          ['Stage', `${d.milestoneNumber} — ${d.milestoneDescription}`],
          ['Share of funds', `${d.fundPercentage}%`],
          ['Value', money(d.displayAmount, d.currency)],
        ]),
        onChainProof({
          transactionHash: d.transactionHash,
          explorerUrl: d.explorerUrl,
          amount: eth(d.amountWei),
          note: 'The payment transaction, permanently recorded on the public ledger.',
        }),
      ],
      cta: { label: 'View the project', href: d.link },
    }),
    text: textBlock([
      greet(d.name),
      '',
      'This stage of work has been approved and its funds released to your wallet.',
      '',
      textFacts([
        ['Project', d.title],
        ['Stage', `${d.milestoneNumber} - ${d.milestoneDescription}`],
        ['Amount', eth(d.amountWei)],
        ['Value', money(d.displayAmount, d.currency)],
        ['Transaction', d.transactionHash],
      ]),
      '',
      `Verify on Etherscan: ${d.explorerUrl}`,
      '',
      `View the project: ${d.link}`,
      TEXT_FOOTER,
    ]),
  }),

  'milestone.paid.citizen': (d) => ({
    html: page({
      title: `Progress on your report: stage ${d.milestoneNumber} verified and paid`,
      preheader: `${eth(d.amountWei)} released for ${d.milestoneDescription}. Verify it yourself on Etherscan.`,
      name: d.name,
      badgeText: 'Verified and paid',
      badgeTone: 'success',
      intro:
        'A stage of the work on the problem you reported has been photographed, checked automatically, approved by an official, and paid for.',
      blocks: [
        factTable([
          ['Project', d.title],
          ['Stage completed', `${d.milestoneNumber} — ${d.milestoneDescription}`],
          ['Share of the total', `${d.fundPercentage}%`],
          ['Value', money(d.displayAmount, d.currency)],
        ]),
        onChainProof({
          transactionHash: d.transactionHash,
          explorerUrl: d.verifyYourself ?? d.explorerUrl,
          amount: eth(d.amountWei),
          note: 'This is the actual payment, on a public ledger no one can edit — including us.',
        }),
      ],
      cta: { label: 'See the full money trail', href: d.link },
    }),
    text: textBlock([
      greet(d.name),
      '',
      'A stage of the work on the problem you reported has been photographed, checked',
      'automatically, approved by an official, and paid for.',
      '',
      textFacts([
        ['Project', d.title],
        ['Stage completed', `${d.milestoneNumber} - ${d.milestoneDescription}`],
        ['Share of the total', `${d.fundPercentage}%`],
        ['Amount paid', eth(d.amountWei)],
        ['Value', money(d.displayAmount, d.currency)],
        ['Transaction', d.transactionHash],
      ]),
      '',
      'You do not have to take our word for it. This record is public and we cannot',
      'alter it:',
      `  ${d.verifyYourself ?? d.explorerUrl}`,
      '',
      `See the full money trail: ${d.link}`,
      TEXT_FOOTER,
    ]),
  }),

  'project.completed.contractor': (d) => ({
    html: page({
      title: 'Project complete',
      preheader: `All stages of ${d.title} are approved and paid.`,
      name: d.name,
      badgeText: 'Complete',
      badgeTone: 'success',
      intro: 'Every stage of this project has been approved and paid. The escrow is now empty and the project is closed.',
      blocks: [
        factTable([
          ['Project', d.title],
          ['Total released', eth(d.totalReleasedFunds)],
        ]),
        onChainProof({
          explorerUrl: d.contractExplorerUrl,
          note: 'The full payment history for this project.',
        }),
      ],
      cta: { label: 'View the project', href: d.link },
    }),
    text: textBlock([
      greet(d.name),
      '',
      'Every stage of this project has been approved and paid. The escrow is now empty',
      'and the project is closed.',
      '',
      textFacts([
        ['Project', d.title],
        ['Total released', eth(d.totalReleasedFunds)],
      ]),
      '',
      `Full payment history: ${d.contractExplorerUrl}`,
      '',
      `View the project: ${d.link}`,
      TEXT_FOOTER,
    ]),
  }),

  'project.completed.citizen': (d) => ({
    html: page({
      title: 'The problem you reported has been fixed',
      preheader: `All stages of ${d.title} are complete, verified and paid.`,
      name: d.name,
      badgeText: 'Fixed',
      badgeTone: 'success',
      intro: [
        'The problem you reported has been repaired. Every stage was photographed, checked, approved by an official and paid for — and all of it is on the public record.',
        'Thank you for reporting it. None of this would have happened otherwise.',
      ],
      blocks: [
        factTable([
          ['Project', d.title],
          ['Total spent', eth(d.totalReleasedFunds)],
        ]),
        onChainProof({
          explorerUrl: d.contractExplorerUrl,
          note: 'Every payment made on this project, on a ledger we cannot edit.',
        }),
      ],
      cta: { label: 'See the full money trail', href: d.link },
    }),
    text: textBlock([
      greet(d.name),
      '',
      'The problem you reported has been repaired. Every stage was photographed, checked,',
      'approved by an official and paid for — and all of it is on the public record.',
      '',
      'Thank you for reporting it. None of this would have happened otherwise.',
      '',
      textFacts([
        ['Project', d.title],
        ['Total spent', eth(d.totalReleasedFunds)],
      ]),
      '',
      `Every payment on this project: ${d.contractExplorerUrl}`,
      '',
      `See the full money trail: ${d.link}`,
      TEXT_FOOTER,
    ]),
  }),
};

/** Event names every notification hook can dispatch. */
export const TEMPLATE_EVENTS = Object.keys(TEMPLATES);

/**
 * Render an event to { html, text }.
 *
 * An unknown event throws rather than sending a blank email — notification
 * dispatch catches it, logs it, and the request is unaffected.
 */
export const render = (event, data = {}) => {
  const template = TEMPLATES[event];
  if (!template) throw new Error(`No email template registered for event '${event}'.`);
  return template(data);
};

export default render;
