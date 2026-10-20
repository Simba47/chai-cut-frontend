import { BrandLoaderScreen } from '@/components/ui/brand-loader'
import { preloadMascot } from '@/components/ui/mascot'

// Shown the moment the dashboard is opened (from the logo, a breadcrumb or after signing in)
// (the panda asleep at its desk, on black)
export default function DashboardLoading() {
  preloadMascot('dashboard')
  return <BrandLoaderScreen mascot="dashboard" label="Loading your videos…" />
}
