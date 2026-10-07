import type { Metadata } from 'next'
import Link from 'next/link'
import { LegalPage, type LegalSection } from '@/components/legal/LegalPage'
import { COMPANY } from '@/lib/company'
import { EmailLink } from '@/components/ui/email-link'

export const metadata: Metadata = {
  title: 'Delete Your Account — Shortcut',
  description: 'How to delete your Shortcut account and what happens to your data.',
}

const UPDATED = 'October 7, 2026'
const mail = <EmailLink />

// Steps match the Delete account card in app/settings/page.tsx; keep them in step.
const SECTIONS: LegalSection[] = [
  {
    id: 'in-app',
    title: 'Delete your account in the app',
    body: <>
      <p>You can delete your Shortcut account yourself at any time, on the website or in the Android or iOS app:</p>
      <ol className="legal-steps">
        <li>Sign in to Shortcut.</li>
        <li>Tap your profile picture or initial at the top of the screen and choose <strong>Account settings</strong>.</li>
        <li>Scroll down to <strong>Delete account</strong> and choose <strong>Delete my account…</strong></li>
        <li>Enter your password and type <strong>DELETE</strong> to confirm.</li>
        <li>Choose <strong>Delete my account for good</strong>.</li>
      </ol>
      <p>Your account is deleted straight away and you are signed out.</p>
    </>,
  },
  {
    id: 'by-email',
    title: 'Ask us to delete it by email',
    body: <>
      <p>If you can’t sign in, or don’t have the app any more, email {mail} from the email address on your Shortcut account, with the subject <strong>“Account Deletion Request”</strong>.</p>
      <p>We may ask you to confirm that the account is yours. We will then delete it within 7 business days and email you when it’s done.</p>
    </>,
  },
  {
    id: 'what-gets-deleted',
    title: 'What gets deleted',
    body: <>
      <p>When your account is deleted, we permanently remove:</p>
      <ul>
        <li>Your account details: email address, name and password.</li>
        <li>Every video you uploaded or imported, and the audio taken from it.</li>
        <li>All your clips, exports and edits, including captions, text, layouts and stock videos you added.</li>
        <li>Transcripts and AI results: chosen moments, hooks, titles, captions and hashtags.</li>
        <li>Your plan details and settings.</li>
      </ul>
    </>,
  },
  {
    id: 'what-we-keep',
    title: 'What we may keep',
    body: <>
      <p>We keep a small amount of information only where the law requires it or where we need it to protect ourselves:</p>
      <ul>
        <li><strong>Payment and tax records</strong> for paid plans, kept for as long as Indian tax and accounting laws require (usually up to 8 years). These are held by us or our payment partner.</li>
        <li><strong>Records needed to resolve a dispute</strong> or a legal claim that is open when you delete your account, until it is resolved.</li>
        <li><strong>Anonymous usage totals</strong> that cannot be linked back to you.</li>
      </ul>
    </>,
  },
  {
    id: 'timeline',
    title: 'How long deletion takes',
    body: <>
      <ul>
        <li><strong>Deleting in the app:</strong> your account, videos and clips are deleted immediately.</li>
        <li><strong>Deleting by email:</strong> within 7 business days of us confirming the request.</li>
        <li><strong>Backups:</strong> any remaining copies in our backups are removed within 30 days.</li>
      </ul>
    </>,
  },
  {
    id: 'before-you-delete',
    title: 'Before you delete',
    body: <>
      <ul>
        <li><strong>Download your clips.</strong> Once your account is deleted, your videos and clips cannot be recovered.</li>
        <li><strong>Cancel any App Store or Google Play subscription.</strong> Deleting your account, or the app, does not cancel a subscription you bought through Apple or Google. Cancel it in your App Store or Google Play subscription settings so you are not charged again.</li>
        <li><strong>Clips you already posted stay posted.</strong> Deleting Shortcut does not remove clips you uploaded to YouTube, Instagram or other platforms. Remove them there if you want to.</li>
      </ul>
    </>,
  },
  {
    id: 'recovery',
    title: 'Account recovery',
    body: <>
      <p>Deleting your account is permanent and cannot be undone. If you want to use Shortcut again, you can sign up with the same email address, but your old videos, clips and plan will not come back.</p>
    </>,
  },
  {
    id: 'contact',
    title: 'Contact us',
    body: <>
      <p>If you have trouble deleting your account, or want to know what data we hold before you go, contact us at {mail} or see our <Link href="/support">Support</Link> page. You can also read how we handle your data in our <Link href="/privacy">Privacy Policy</Link>.</p>
      <div className="legal-contact">
        <p><strong>{COMPANY.legalName}</strong></p>
        <p>{COMPANY.address.join(', ')}, India</p>
      </div>
    </>,
  },
]

export default function DeleteAccountPage() {
  return (
    <LegalPage
      eyebrow="Account management"
      title="Delete Your Account"
      updated={UPDATED}
      intro={<>
        <p>This page explains how to delete your Shortcut account, what happens to your data when you do, and what we keep. Shortcut is run by {COMPANY.legalName}.</p>
      </>}
      sections={SECTIONS}
    />
  )
}
