import { AuthSlider } from '@/components/auth/AuthSlider'
import { googleOn } from '@/auth'

export default function SignupPage() {
  return <AuthSlider initialMode="signup" google={googleOn()} />
}
