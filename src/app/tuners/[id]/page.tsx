import { notFound } from "next/navigation";
import TrackView from "@/components/tuners/TrackView";
import { findTrack } from "@/lib/catalog";

export default async function TrackPage({ params }: PageProps<"/tuners/[id]">) {
  const { id } = await params;
  const track = findTrack(id);
  if (!track) notFound();
  return <TrackView track={track} />;
}
