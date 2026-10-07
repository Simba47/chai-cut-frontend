import type { Metadata } from 'next'
import Link from 'next/link'
import { LegalPage, type LegalSection } from '@/components/legal/LegalPage'
import { COMPANY } from '@/lib/company'
import { EmailLink } from '@/components/ui/email-link'

export const metadata: Metadata = {
  title: 'Privacy Policy — Shortcut',
  description: 'How Shortcut collects, uses, shares and protects your information.',
}

const UPDATED = 'October 7, 2026'
const mail = <EmailLink />

// Outside services that process data for us. Keep in step with the code (src/lib, src/server/services).
const PROVIDERS: [string, string, string][] = [
  ['Cloudflare (R2)', 'Stores your uploaded videos, audio and finished clips', 'Your videos, audio and clips'],
  ['Our database host', 'Stores your account, projects and settings', 'Account details and project data'],
  ['Sarvam AI', 'Turns the speech in your videos into text (transcription and captions)', 'Audio from your videos'],
  ['Google (Gemini)', 'Finds the best moments and writes hooks, titles, captions and hashtags', 'Transcripts of your videos'],
  ['Anthropic (Claude)', 'Finds the best moments in your videos', 'Transcripts of your videos'],
  ['Resend', 'Sends verification codes and account emails', 'Your email address'],
  ['Pexels and Pixabay', 'Supply stock videos you search for in the editor', 'The search words you type (no personal details)'],
  ['Our payment partner', 'Processes payments for paid plans', 'Payment details you enter at checkout'],
]

const SECTIONS: LegalSection[] = [
  {
    id: 'who-we-are',
    title: 'Who we are',
    body: <>
      <p>Shortcut is a video editing service that turns long videos into short, vertical clips for YouTube Shorts, Instagram Reels and similar platforms. It is available on our website and in our mobile apps for Android and iOS (together, the “Service”).</p>
      <p>The Service is operated by <strong>{COMPANY.legalName}</strong>, {COMPANY.address.join(', ')}, India (“Shortcut”, “we”, “us”, “our”). We are responsible for the personal data described in this policy.</p>
    </>,
  },
  {
    id: 'information-we-collect',
    title: 'Information we collect',
    body: <>
      <h3>Information you give us</h3>
      <ul>
        <li><strong>Account details:</strong> your email address, password and, if you add it, your name. We store your password only in a scrambled (hashed) form that we cannot read.</li>
        <li><strong>Videos and files you upload:</strong> the videos you upload from your device or import from a link (such as a Google Drive link), and any images or logos you add to your clips.</li>
        <li><strong>Your edits:</strong> the clips you make, caption styles, text, layouts, stock videos you add and other editing choices.</li>
        <li><strong>Plan and payment details:</strong> the plan you choose and its status. If you buy a paid plan, your card or UPI details are collected and processed by our payment partner. We do not store your full card details.</li>
        <li><strong>Messages to us:</strong> what you send when you email, call or message us for support.</li>
      </ul>
      <h3>Information created when you use Shortcut</h3>
      <ul>
        <li><strong>Transcripts and AI results:</strong> the text of what is said in your videos, the moments chosen for clips, and the hooks, titles, captions and hashtags written for them.</li>
        <li><strong>Technical information:</strong> basic details our servers receive when you use the Service, such as your IP address, device and browser type, and the time of your visit. We use these to keep the Service working and secure.</li>
      </ul>
      <p>We do not collect your contacts, precise location, or information from your social media accounts.</p>
    </>,
  },
  {
    id: 'how-we-use',
    title: 'How we use your information',
    body: <>
      <ul>
        <li>To create and manage your account, and to verify your email address with a one-time code.</li>
        <li>To provide the Service: store your videos, transcribe them, find clip-worthy moments, generate captions and text, and render your finished clips.</li>
        <li>To manage your plan, usage limits and payments.</li>
        <li>To send you important messages about your account, such as verification codes, password resets and changes to these terms.</li>
        <li>To answer your questions and give you support.</li>
        <li>To keep the Service safe, prevent misuse and fix problems.</li>
        <li>To comply with the law.</li>
      </ul>
      <p>We do not sell your personal data, and we do not use your videos for advertising.</p>
    </>,
  },
  {
    id: 'ai-processing',
    title: 'How AI is used on your videos',
    body: <>
      <p>Shortcut uses artificial intelligence to do the work for you. When you upload a video, its audio is sent to a speech-to-text service to create a transcript, and the transcript is sent to AI language models that pick the best moments and write hooks, titles, captions and hashtags. These services are listed in section 5.</p>
      <p>We send these services only what they need to do the task, and they process it on our behalf. We do not use your videos to train AI models of our own. AI results can be wrong, so please review your clips and captions before you post them.</p>
    </>,
  },
  {
    id: 'sharing',
    title: 'Who we share information with',
    body: <>
      <p>We share your information only with the service providers that help us run Shortcut, and only as much as they need to do their job:</p>
      <div className="legal-table-wrap">
        <table className="legal-table">
          <thead><tr><th>Service</th><th>What it does for us</th><th>What it receives</th></tr></thead>
          <tbody>{PROVIDERS.map(([name, does, gets]) => <tr key={name}><td>{name}</td><td>{does}</td><td>{gets}</td></tr>)}</tbody>
        </table>
      </div>
      <p>We may also share information:</p>
      <ul>
        <li><strong>When the law requires it,</strong> for example in response to a valid court order or a request from a government authority.</li>
        <li><strong>To protect rights and safety,</strong> including to prevent fraud or misuse of the Service.</li>
        <li><strong>If our business changes hands,</strong> such as in a merger or acquisition. The new owner will have to protect your information in line with this policy.</li>
      </ul>
      <p>Your videos and clips are private to your account. They are only published somewhere if you download them and post them yourself.</p>
    </>,
  },
  {
    id: 'app-permissions',
    title: 'Mobile app permissions',
    body: <>
      <p>Our mobile apps ask for permission only when a feature needs it:</p>
      <ul>
        <li><strong>Photos, videos and files:</strong> to let you pick a video to upload and to save finished clips to your device. The app only reads the files you choose.</li>
        <li><strong>Internet access:</strong> to upload your videos and use the Service.</li>
        <li><strong>Notifications (if you allow them):</strong> to tell you when your clips are ready.</li>
      </ul>
      <p>You can turn these permissions off at any time in your phone’s settings. Some features may not work without them.</p>
    </>,
  },
  {
    id: 'cookies',
    title: 'Cookies and similar technologies',
    body: <>
      <p>We use a small number of cookies and similar storage on your device that are needed for the Service to work, mainly to keep you signed in and to remember your settings. We do not use advertising cookies or sell data to advertisers.</p>
      <p>You can block or delete cookies in your browser settings, but you will then need to sign in again, and some parts of the Service may not work.</p>
    </>,
  },
  {
    id: 'security',
    title: 'How we protect your information',
    body: <>
      <p>We use reasonable technical and organisational measures to protect your information, including encrypted connections (HTTPS), hashed passwords, private storage for your videos with time-limited access links, and limited staff access to personal data.</p>
      <p>No online service can be completely secure. If we learn of a breach that affects your personal data, we will inform you and the relevant authorities as the law requires.</p>
    </>,
  },
  {
    id: 'retention',
    title: 'How long we keep your information',
    body: <>
      <p>We keep your account details for as long as your account is open. Your videos, clips and transcripts are kept for the history period of your plan, shown on our pricing page, after which we may delete them (see our <Link href="/terms">Terms and Conditions</Link>). You can delete individual videos and clips at any time.</p>
      <p>When you delete your account, we delete your account details, videos, audio, clips, transcripts and project data. Copies in our backups are removed within 30 days. We may keep limited records, such as payment and tax records, for as long as the law requires.</p>
    </>,
  },
  {
    id: 'delete-account',
    title: 'Deleting your account',
    body: <>
      <p>You can delete your account and all of its data yourself, at any time:</p>
      <ul>
        <li><strong>In the app or on the website:</strong> sign in, open <strong>Account settings</strong>, and choose <strong>Delete my account…</strong>. Confirm with your password. This cannot be undone.</li>
        <li><strong>By email:</strong> if you cannot sign in, email {mail} from the email address on your account and ask us to delete it. We will confirm it is you and delete the account within 7 business days.</li>
      </ul>
      <p>See <Link href="/delete-account">Delete your account</Link> for step-by-step instructions and exactly what is deleted.</p>
    </>,
  },
  {
    id: 'your-rights',
    title: 'Your rights',
    body: <>
      <p>Under India’s Digital Personal Data Protection Act, 2023, and other laws that apply to you, you have the right to:</p>
      <ul>
        <li>Get a summary of the personal data we hold about you and how we use it.</li>
        <li>Correct or update personal data that is wrong or incomplete. You can change your name and password in Settings.</li>
        <li>Have your personal data deleted (see section 10).</li>
        <li>Withdraw your consent at any time. This will not affect what we did before you withdrew it, but we may no longer be able to provide the Service.</li>
        <li>Raise a complaint with our Grievance Officer (see section 16), and if you are not satisfied, with the Data Protection Board of India.</li>
        <li>Nominate another person to exercise these rights for you if you die or become unable to do so.</li>
      </ul>
      <p>To use any of these rights, email {mail}. We will reply within 30 days.</p>
    </>,
  },
  {
    id: 'children',
    title: 'Children',
    body: <>
      <p>Shortcut is meant for people aged 18 and over. We do not knowingly collect personal data from anyone under 18. If you believe a child has given us their information, email {mail} and we will delete it.</p>
    </>,
  },
  {
    id: 'international',
    title: 'Where your information is processed',
    body: <>
      <p>We are based in India. Some of our service providers process data on servers in other countries. When that happens, we take steps to make sure your information is protected as described in this policy and as Indian law requires.</p>
    </>,
  },
  {
    id: 'links',
    title: 'Other websites and services',
    body: <>
      <p>The Service may link to or work with other services, such as Google Drive, YouTube or Instagram. Their own privacy policies apply to how they handle your information, and we are not responsible for them.</p>
    </>,
  },
  {
    id: 'changes',
    title: 'Changes to this policy',
    body: <>
      <p>We may update this policy from time to time. When we do, we will change the “Last updated” date at the top. If the changes are significant, we will also tell you by email or in the app before they take effect.</p>
    </>,
  },
  {
    id: 'contact',
    title: 'Contact us and Grievance Officer',
    body: <>
      <p>If you have any questions or complaints about this policy or your personal data, please contact our Grievance Officer:</p>
      <div className="legal-contact">
        <p><strong>Grievance Officer, {COMPANY.legalName}</strong></p>
        <p>Email: {mail}</p>
        <p>Phone: <a href={`tel:${COMPANY.phone.replace(/\s/g, '')}`}>{COMPANY.phone}</a></p>
        <p>Address: {COMPANY.address.join(', ')}, India</p>
      </div>
      <p style={{ marginTop: 12 }}>We will acknowledge your complaint within 48 hours and try to resolve it within 30 days.</p>
    </>,
  },
]

export default function PrivacyPage() {
  return (
    <LegalPage
      eyebrow="Data protection"
      title="Privacy Policy"
      updated={UPDATED}
      intro={<>
        <p>This Privacy Policy explains what information Shortcut collects when you use our website and mobile apps, how we use it, who we share it with, and the choices you have.</p>
        <p>By using Shortcut, you agree to this policy. If you do not agree, please do not use the Service.</p>
      </>}
      sections={SECTIONS}
    />
  )
}
