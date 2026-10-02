import { BrandLoaderScreen } from '@/components/ui/brand-loader'

// Shown the moment the dashboard is opened (from the logo, a breadcrumb or after signing in)
export default function DashboardLoading() {
  return <BrandLoaderScreen label="Loading your videos…" />
}
