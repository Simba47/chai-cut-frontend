import { BrandLoaderScreen } from '@/components/ui/brand-loader'
import { preloadMascot } from '@/components/ui/mascot'

// Shown the moment "Make clips" is clicked, while the clip board loads the video and its clips
export default function ClipBoardLoading() {
  preloadMascot('clipboard')
  return <BrandLoaderScreen mascot="clipboard" label="Opening your clip board…" />
}
