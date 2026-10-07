import type { Metadata } from 'next'
import Link from 'next/link'
import { Mail, MessageCircle, Phone } from 'lucide-react'
import { LegalPage, type LegalSection } from '@/components/legal/LegalPage'
import { COMPANY } from '@/lib/company'
import { EmailLink } from '@/components/ui/email-link'
import { PLANS } from '@/lib/plans'
import { ACCEPTED_VIDEO_EXTENSIONS, SARVAM_LANGUAGES } from '@/lib/shared/constants'

export const metadata: Metadata = {
  title: 'Support — Shortcut',
  description: 'Get help with Shortcut: uploads, clips, captions, your account and billing.',
}

const UPDATED = 'October 7, 2026'
const mail = <EmailLink />
const tel = COMPANY.phone.replace(/\s/g, '')
const WHATSAPP = `https://wa.me/${tel.replace('+', '')}`

const formats = ACCEPTED_VIDEO_EXTENSIONS.map(e => e.slice(1).toUpperCase()).join(', ')
const languages = SARVAM_LANGUAGES.map(l => l.label).join(', ')
const maxSizes = Object.values(PLANS).map(p => `${p.maxFileSizeGb} GB on ${p.name}`).join(', ')

const SECTIONS: LegalSection[] = [
  {
    id: 'contact',
    title: 'Contact support',
    body: <>
      <p>For any question, problem or feedback, email us at {mail} or message us on <a href={WHATSAPP} target="_blank" rel="noopener noreferrer">WhatsApp</a>. We usually reply within 24–48 hours on business days (Monday to Saturday).</p>
      <p>To help us fix things faster, please include:</p>
      <ul>
        <li>The email address you use for Shortcut.</li>
        <li>What you were trying to do and what went wrong.</li>
        <li>A screenshot or screen recording, if you can.</li>
      </ul>
    </>,
  },
  {
    id: 'uploads',
    title: 'Uploading and importing videos',
    body: <>
      <ul>
        <li><strong>Supported files:</strong> {formats}.</li>
        <li><strong>Maximum file size:</strong> {maxSizes}.</li>
        <li><strong>Google Drive or Dropbox links:</strong> copy the link to the video file itself, not to a folder, and set sharing to <strong>“Anyone with the link”</strong> so Shortcut can open it.</li>
        <li><strong>YouTube links:</strong> importing from YouTube is coming soon. For now, upload the file or use a Drive or Dropbox link.</li>
        <li><strong>Upload stopped halfway?</strong> Keep the page open on a steady connection until the upload finishes, then try again. If it keeps failing, email us the file name and size.</li>
        <li><strong>“Your plan allows … videos”:</strong> you have reached your plan’s video limit. Delete an old video or upgrade your plan.</li>
      </ul>
    </>,
  },
  {
    id: 'clips',
    title: 'Clips, captions and editing',
    body: <>
      <ul>
        <li><strong>Caption languages:</strong> {languages}.</li>
        <li><strong>A word in the captions is wrong:</strong> open the clip in the editor and fix the text, or re-render to transcribe it again.</li>
        <li><strong>The AI picked the wrong moment or framing:</strong> drag the start and end of the clip on the timeline, or move the crop box. You stay in control of every clip.</li>
        <li><strong>Hook, title or hashtags don’t fit:</strong> edit them in the editor before you post. AI results can be wrong, so always check them.</li>
        <li><strong>Watermark on my clips:</strong> clips on the free plan carry a Shortcut watermark. Paid plans remove it.</li>
      </ul>
    </>,
  },
  {
    id: 'account',
    title: 'Signing in and your account',
    body: <>
      <ul>
        <li><strong>Didn’t get the verification code?</strong> Check your spam or promotions folder, make sure the email address is spelled right, and wait a minute before asking for a new code. Each code expires after 10 minutes.</li>
        <li><strong>Forgot your password?</strong> On the sign-in page, choose <strong>Forgot password</strong> and we’ll email you a code to set a new one.</li>
        <li><strong>Change your name or password:</strong> sign in and open <strong>Account settings</strong> from your profile menu.</li>
        <li><strong>Want to change the email on your account?</strong> Email {mail} from your current address.</li>
      </ul>
    </>,
  },
  {
    id: 'billing',
    title: 'Plans and billing',
    body: <>
      <ul>
        <li><strong>Compare plans and upgrade:</strong> see the <Link href="/#pricing">pricing section</Link> on our home page.</li>
        <li><strong>Bought in the iPhone or Android app?</strong> Apple or Google handles that payment. Manage or cancel it in your App Store or Google Play subscription settings. Deleting the app does not cancel it.</li>
        <li><strong>Charged twice or charged by mistake?</strong> Email {mail} within 7 days with the date, amount and a screenshot of the payment.</li>
        <li>For cancellations and refunds, see our <Link href="/terms#cancel-refunds">Terms and Conditions</Link>.</li>
      </ul>
    </>,
  },
  {
    id: 'delete-account',
    title: 'Deleting your account',
    body: <>
      <p>You can delete your account and everything in it yourself:</p>
      <ol className="legal-steps">
        <li>Sign in to Shortcut on the website or in the app.</li>
        <li>Open <strong>Account settings</strong> from your profile menu.</li>
        <li>Choose <strong>Delete my account…</strong>, enter your password and type <strong>DELETE</strong> to confirm.</li>
      </ol>
      <p>This permanently deletes your account, videos, clips and transcripts, and it cannot be undone. Download any clips you want to keep first. If you can’t sign in, email {mail} from your account’s email address and we’ll delete it for you. See <Link href="/delete-account">Delete your account</Link> for full details.</p>
    </>,
  },
  {
    id: 'bugs',
    title: 'Report a bug',
    body: <>
      <p>If something isn’t working as it should, email {mail} with:</p>
      <ul>
        <li>The steps that led to the problem.</li>
        <li>Your device and browser, or app version (for example, “iPhone 14, iOS 18” or “Chrome on Windows”).</li>
        <li>Screenshots or a screen recording.</li>
      </ul>
      <p>Your reports help us make Shortcut better for everyone.</p>
    </>,
  },
  {
    id: 'report-content',
    title: 'Report copyright or abuse',
    body: <>
      <p>If you believe someone has used Shortcut with your copyrighted video, or to make harmful or misleading content, email {mail} with the subject <strong>“Copyright”</strong> or <strong>“Abuse”</strong>. See <Link href="/terms#copyright-complaints">Copyright complaints</Link> in our Terms for what to include.</p>
    </>,
  },
  {
    id: 'general',
    title: 'General enquiries',
    body: <>
      <p>For partnerships, press or anything else about Shortcut, email {mail}. You can also write to us at:</p>
      <div className="legal-contact">
        <p><strong>{COMPANY.legalName}</strong></p>
        <p>{COMPANY.address.join(', ')}, India</p>
      </div>
    </>,
  },
]

export default function SupportPage() {
  return (
    <LegalPage
      eyebrow="Help & support"
      title="Support"
      updated={UPDATED}
      intro={<>
        <p>Need help with Shortcut? Reach us any way you like, or find a quick answer below.</p>
        <div className="support-channels">
          <EmailLink className="support-channel">
            <Mail aria-hidden /><span><strong>Email</strong>{COMPANY.email}</span>
          </EmailLink>
          <a className="support-channel" href={WHATSAPP} target="_blank" rel="noopener noreferrer">
            <MessageCircle aria-hidden /><span><strong>WhatsApp</strong>Chat with us</span>
          </a>
          <a className="support-channel" href={`tel:${tel}`}>
            <Phone aria-hidden /><span><strong>Phone</strong>{COMPANY.phone}</span>
          </a>
        </div>
      </>}
      sections={SECTIONS}
    />
  )
}
