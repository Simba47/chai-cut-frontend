import { BrandLoaderScreen } from '@/components/ui/brand-loader'
import { preloadMascot } from '@/components/ui/mascot'

// Shown the moment a clip is opened (Edit, Create & edit, Use)
export default function EditorLoading() {
  preloadMascot()
  return <BrandLoaderScreen mascot label="Getting your clip ready, please wait…" />
}
