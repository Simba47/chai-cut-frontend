export interface SarvamWord {
  word: string
  start: number  // seconds
  end: number
  speaker: string
  confidence?: number
}

export interface SarvamTranscribeResponse {
  transcript: string
  language_code: string
  diarized_transcript?: {
    entries: SarvamWord[]
  }
}

export async function transcribeAudio(
  audioBuffer: Buffer,
  languageCode = 'te-IN',
): Promise<SarvamTranscribeResponse> {
  const apiKey = process.env.SARVAM_API_KEY
  if (!apiKey) throw new Error('SARVAM_API_KEY is not set')

  const formData = new FormData()
  formData.append('file', new Blob([audioBuffer.buffer as ArrayBuffer], { type: 'audio/wav' }), 'audio.wav')
  formData.append('model', 'saarika:v2')
  formData.append('language_code', languageCode)
  formData.append('with_diarization', 'true')
  formData.append('with_timestamps', 'true')

  const res = await fetch('https://api.sarvam.ai/speech-to-text', {
    method: 'POST',
    headers: { 'api-subscription-key': apiKey },
    body: formData,
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Sarvam API error ${res.status}: ${text}`)
  }

  return res.json() as Promise<SarvamTranscribeResponse>
}
