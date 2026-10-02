import { redirect } from 'next/navigation'

// Uploading and link imports live on the dashboard now (resumable uploads, Google Drive and
// Dropbox links). This old page offered YouTube links, which only worked on a home machine.
export default function UploadPage() {
  redirect('/dashboard')
}
