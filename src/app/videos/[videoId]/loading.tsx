import { BrandLoaderScreen } from '@/components/ui/brand-loader'

// Shown the moment "Make clips" is clicked, while the clip board loads the video and its clips
export default function ClipBoardLoading() {
  return <BrandLoaderScreen label="Opening your clip board…" />
}
