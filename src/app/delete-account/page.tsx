import type { Metadata } from 'next'
import Link from 'next/link'
import { AlertTriangle, Archive, Clock, Link2, Mail, RotateCcw, Trash2, UserX } from 'lucide-react'
import { LegalCardPage, type LegalCard } from '@/components/legal/LegalCardPage'
import { COMPANY } from '@/lib/company'
import { EmailLink } from '@/components/ui/email-link'

export const metadata: Metadata = {
  title: 'Delete Account — Shortcut',
  description: 'How to delete your Shortcut account and what happens to your data.',
}

const UPDATED = 'October 8, 2026'
const mail = <EmailLink />

// Steps match the Delete account card in app/settings/page.tsx, and "What Gets Deleted" matches
// deleteAccount in src/server/services/account.ts. Keep them in step.
const CARDS: LegalCard[] = [
  {
    icon: UserX,
    title: 'How to Delete Your Account',
    body: <>You can delete your account yourself at any time, on the Shortcut website or in our Android or iOS app: sign in, tap your profile picture or initial at the top of the screen, choose Account settings, scroll down to Delete account and choose Delete my account…, then enter your password, type DELETE, and choose Delete my account for good. If you can’t sign in or no longer have the app, email us at {mail} with the subject line ‘Account Deletion Request’ from the email address on your account. We may ask you to confirm the account is yours, and we will process your request within 7 business days.</>,
  },
  {
    icon: Trash2,
    title: 'What Gets Deleted',
    body: <>When your account is deleted, we permanently remove your account details (email address, name and password), every video you uploaded or imported and the audio taken from it, all your clips and exports, your edits (captions, text, layouts and stock videos you added), the images and logos you uploaded, your transcripts and AI results (chosen moments, hooks, titles, captions and hashtags), and your plan details and settings. Your login credentials are erased and cannot be recovered after deletion is complete.</>,
  },
  {
    icon: Archive,
    title: 'Data We Retain',
    body: <>We do not keep any copies of your videos, clips or transcripts after deletion. We only retain information where the law requires it or where we need it to protect our rights: payment and tax records for paid plans, kept by us, our payment partner, Apple or Google for as long as Indian tax and accounting laws require (usually up to 8 years), and records needed to resolve a dispute or legal claim that is open when you delete your account, until it is resolved.</>,
  },
  {
    icon: Clock,
    title: 'Deletion Timeline',
    body: <>When you delete your account in the app or on the website, your account, videos, clips and files are deleted immediately and you are signed out. When you ask us by email, we delete everything within 7 business days of confirming your request and email you when it’s done. Any remaining copies in our backups are permanently removed within 30 days.</>,
  },
  {
    icon: AlertTriangle,
    title: 'Before You Delete — Important Notices',
    body: <>Download any clips you want to keep, because your videos and clips cannot be recovered after deletion. If you subscribed to a paid plan through the App Store or Google Play, cancel it in your App Store or Google Play subscription settings first: deleting your account or the app does not cancel a subscription billed by Apple or Google. This action is irreversible.</>,
  },
  {
    icon: Link2,
    title: 'Third-Party Data',
    body: <>Shortcut does not connect to your YouTube, Instagram or other social media accounts, so there is no access to revoke. Clips you have already posted on those platforms are not affected by deleting Shortcut; remove them on those platforms if you want to. The service providers that process data for us, listed in our <Link href="/privacy">Privacy Policy</Link>, process it only on our behalf to provide Shortcut.</>,
  },
  {
    icon: RotateCcw,
    title: 'Account Recovery',
    body: <>Account deletion is permanent and cannot be undone. If you change your mind, you can sign up again with the same email address, but your past videos, clips, edits and plan will not be restored to the new account.</>,
  },
  {
    icon: Mail,
    title: 'Contact Us',
    body: <>If you have trouble deleting your account or want to understand what data we hold before proceeding, please contact us at {mail} or see our <Link href="/support">Support</Link> page, or write to us at: {COMPANY.legalName}, {COMPANY.address.join(', ')}, India. We are committed to honouring your data rights promptly.</>,
  },
]

export default function DeleteAccountPage() {
  return <LegalCardPage badge="Account Management" badgeIcon={Trash2} title="Delete Account" updated={UPDATED} cards={CARDS} danger />
}
