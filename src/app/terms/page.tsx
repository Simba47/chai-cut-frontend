import type { Metadata } from 'next'
import Link from 'next/link'
import { LegalPage, type LegalSection } from '@/components/legal/LegalPage'
import { COMPANY } from '@/lib/company'
import { EmailLink } from '@/components/ui/email-link'

export const metadata: Metadata = {
  title: 'Terms and Conditions — Shortcut',
  description: 'The rules for using Shortcut, our video clipping service.',
}

const UPDATED = 'October 7, 2026'
const mail = <EmailLink />
const privacy = <Link href="/privacy">Privacy Policy</Link>

const SECTIONS: LegalSection[] = [
  {
    id: 'acceptance',
    title: 'Accepting these terms',
    body: <>
      <p>These Terms and Conditions (“Terms”) are a legal agreement between you and <strong>{COMPANY.legalName}</strong> (“Shortcut”, “we”, “us”, “our”). They apply when you use Shortcut on our website or in our mobile apps for Android and iOS (together, the “Service”).</p>
      <p>By creating an account or using the Service, you agree to these Terms and to our {privacy}. If you do not agree, please do not use the Service.</p>
    </>,
  },
  {
    id: 'service',
    title: 'What Shortcut does',
    body: <>
      <p>Shortcut is a video editing service. You upload a long video, and Shortcut transcribes it, finds the best moments, and helps you turn them into short vertical clips with captions, titles and hashtags, ready to post on platforms such as YouTube Shorts and Instagram Reels.</p>
      <p>We are always improving Shortcut, so features may change, be added or be removed over time.</p>
    </>,
  },
  {
    id: 'accounts',
    title: 'Your account',
    body: <>
      <ul>
        <li>You must be at least 18 years old to use Shortcut.</li>
        <li>You must give us a real email address that you can access, and keep your account details up to date.</li>
        <li>You are responsible for keeping your password safe and for everything that happens in your account. If you think someone else has used your account, tell us at {mail} straight away.</li>
        <li>One person may not share an account with others, or create accounts to get around plan limits.</li>
      </ul>
    </>,
  },
  {
    id: 'your-content',
    title: 'Your videos and content',
    body: <>
      <p><strong>You own your content.</strong> The videos you upload and the clips you make with Shortcut belong to you (or to whoever you got them from). We do not claim ownership of them.</p>
      <p><strong>You must have the right to use it.</strong> Only upload videos that you own or have permission to use and edit. Clipping videos you don’t have the rights to can get your channel struck or demonetised, and may break the law. You are responsible for the content you upload and for the clips you post.</p>
      <p><strong>Permission you give us.</strong> To run the Service, you allow us to store, copy, process and change your content only as needed to provide Shortcut to you. That includes sending it to the service providers listed in our {privacy} for transcription and AI processing. This permission ends when you delete the content or your account, except for copies we must keep by law.</p>
    </>,
  },
  {
    id: 'acceptable-use',
    title: 'What you must not do',
    body: <>
      <p>When using Shortcut, you must not:</p>
      <ul>
        <li>Upload or make content that you don’t have the rights to, or that infringes someone’s copyright, trademark or other rights.</li>
        <li>Upload or make content that is illegal, sexually explicit, involves children in any harmful way, promotes violence or hatred, harasses others, or spreads false information meant to deceive.</li>
        <li>Create deepfakes or misleading edits that make a real person appear to say or do something they did not.</li>
        <li>Try to hack, overload, copy or reverse-engineer the Service, or get around plan limits, watermarks or security.</li>
        <li>Use bots or automated tools to access the Service without our written permission.</li>
        <li>Resell or give access to the Service to others without our written permission.</li>
        <li>Break any law that applies to you, including India’s Information Technology Act, 2000 and its rules.</li>
      </ul>
      <p>If you break these rules, we may remove the content, suspend or close your account, and report it to the authorities where the law requires.</p>
    </>,
  },
  {
    id: 'ai-output',
    title: 'AI-generated results',
    body: <>
      <p>Shortcut uses artificial intelligence to transcribe speech, choose clip moments, and write hooks, titles, captions and hashtags. AI can make mistakes: a word may be transcribed wrongly, a moment may be cut in the wrong place, or a caption may be inaccurate.</p>
      <p>Always review your clips and text before you post them. You are responsible for what you publish, and we do not promise any number of views, followers or earnings from clips made with Shortcut.</p>
    </>,
  },
  {
    id: 'plans',
    title: 'Plans and payments',
    body: <>
      <ul>
        <li>Shortcut has a free plan and paid plans. The price, limits and features of each plan (such as how many videos you can upload, the maximum file size and how long your history is kept) are shown on our pricing page when you buy.</li>
        <li>Prices are in Indian Rupees (₹) and include taxes where shown. Paid plans are billed monthly or yearly, depending on what you choose.</li>
        <li>If your plan renews automatically, we will say so at checkout, and you will be charged at the start of each new billing period until you cancel.</li>
        <li>If we change the price of your plan, we will tell you before the change applies to you. You can cancel if you do not agree.</li>
        <li>If a payment fails, we may move your account to the free plan until the payment is made.</li>
        <li>Free plan clips carry a Shortcut watermark. You must not remove or hide it.</li>
      </ul>
    </>,
  },
  {
    id: 'cancel-refunds',
    title: 'Cancellations and refunds',
    body: <>
      <p>You can cancel a paid plan at any time. You keep the paid features until the end of the period you have already paid for, and you will not be charged again.</p>
      <p>Payments are not refundable, except where the law requires a refund or where we have charged you by mistake (for example, a double charge). If you think you were charged wrongly, email {mail} within 7 days of the charge and we will look into it.</p>
    </>,
  },
  {
    id: 'app-stores',
    title: 'Buying through the App Store or Google Play',
    body: <>
      <p>If you buy a plan inside our iOS or Android app, the payment is handled by Apple or Google, and their terms apply to billing, renewals, cancellations and refunds. You can manage or cancel these subscriptions in your App Store or Google Play account settings. Deleting the app does not cancel your subscription.</p>
      <p>These Terms are between you and us, not Apple or Google. Apple and Google are not responsible for the Service or for supporting it.</p>
    </>,
  },
  {
    id: 'storage',
    title: 'Storage of your videos',
    body: <>
      <p>Each plan keeps your videos and clips for the number of days shown for that plan on our pricing page. After that period, we may delete them to free up space, so please download any clips you want to keep. We are not responsible for content lost after that period or after you delete it.</p>
    </>,
  },
  {
    id: 'our-ip',
    title: 'Our rights in Shortcut',
    body: <>
      <p>Shortcut’s software, design, logo, name and everything else that makes up the Service (other than your content) belong to us or our licensors and are protected by law. We give you a personal, non-transferable right to use the Service under these Terms. You may not copy, sell or build a competing product from it.</p>
      <p>Stock videos you add from libraries such as Pexels or Pixabay are covered by those libraries’ own licences.</p>
      <p>If you send us ideas or feedback, we may use them freely without paying you.</p>
    </>,
  },
  {
    id: 'third-parties',
    title: 'Other services',
    body: <>
      <p>Shortcut works with other services, such as Google Drive for importing videos and YouTube or Instagram where you post your clips. We do not control those services, and their own terms apply when you use them. We are not responsible for them, or for changes they make that affect how Shortcut works with them.</p>
    </>,
  },
  {
    id: 'copyright-complaints',
    title: 'Copyright complaints',
    body: <>
      <p>We respect the rights of creators. If you believe content on Shortcut infringes your copyright, email {mail} with your contact details, a description of your work, where the infringing content is, and a statement that your complaint is accurate and that you own the rights or act for the owner. We will review it and remove the content where appropriate. We may close the accounts of people who repeatedly infringe.</p>
    </>,
  },
  {
    id: 'termination',
    title: 'Closing your account',
    body: <>
      <p>You can stop using Shortcut and delete your account at any time from <strong>Account settings → Delete account</strong>. This permanently deletes your account and content, as described on our <Link href="/delete-account">Delete your account</Link> page.</p>
      <p>We may suspend or close your account if you break these Terms, if we must do so by law, or if your use puts other users or the Service at risk. Where reasonable, we will tell you first and give you a chance to download your clips. If we close a paid account without you having broken these Terms, we will refund the unused part of your plan.</p>
    </>,
  },
  {
    id: 'disclaimer',
    title: 'The Service is provided “as is”',
    body: <>
      <p>We work hard to keep Shortcut running well, but we provide the Service “as is” and “as available”. We do not promise that it will always be available, free of errors, or that it will meet every need you have. Please keep your own copies of important videos.</p>
    </>,
  },
  {
    id: 'liability',
    title: 'Limit of our liability',
    body: <>
      <p>As far as the law allows, we are not liable for indirect or consequential losses, such as lost profits, lost views or followers, lost data, or damage to your reputation, arising from your use of the Service.</p>
      <p>Our total liability to you for any claim about the Service is limited to the amount you paid us in the 3 months before the claim, or ₹1,000 if you have not paid us anything. Nothing in these Terms limits liability that cannot be limited by law.</p>
    </>,
  },
  {
    id: 'indemnity',
    title: 'Your responsibility for claims',
    body: <>
      <p>If someone brings a claim against us because of content you uploaded or posted, or because you broke these Terms or the law, you agree to cover our reasonable costs and losses from that claim.</p>
    </>,
  },
  {
    id: 'changes',
    title: 'Changes to these terms',
    body: <>
      <p>We may update these Terms from time to time. When we do, we will change the “Last updated” date at the top. If the changes are significant, we will tell you by email or in the app before they take effect. If you keep using Shortcut after that, you accept the new Terms.</p>
    </>,
  },
  {
    id: 'law',
    title: 'Governing law and disputes',
    body: <>
      <p>These Terms are governed by the laws of India. If you have a problem, please contact us first so we can try to sort it out. Any dispute we cannot resolve together will be decided only by the courts in Hyderabad, Telangana, India.</p>
    </>,
  },
  {
    id: 'contact',
    title: 'Contact us',
    body: <>
      <p>If you have any questions about these Terms, please contact us:</p>
      <div className="legal-contact">
        <p><strong>{COMPANY.legalName}</strong></p>
        <p>Email: {mail}</p>
        <p>Phone: <a href={`tel:${COMPANY.phone.replace(/\s/g, '')}`}>{COMPANY.phone}</a></p>
        <p>Address: {COMPANY.address.join(', ')}, India</p>
      </div>
    </>,
  },
]

export default function TermsPage() {
  return (
    <LegalPage
      eyebrow="Legal"
      title="Terms and Conditions"
      updated={UPDATED}
      intro={<>
        <p>These Terms explain the rules for using Shortcut: what you can expect from us, what we expect from you, and how plans and payments work.</p>
        <p>Please read them carefully. By using Shortcut, you agree to them.</p>
      </>}
      sections={SECTIONS}
    />
  )
}
