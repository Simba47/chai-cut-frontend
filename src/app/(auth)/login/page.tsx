import { AuthSlider } from '@/components/auth/AuthSlider'
import { googleOn } from '@/auth'

export default function LoginPage() {
  return <AuthSlider initialMode="signin" google={googleOn()} />
}
