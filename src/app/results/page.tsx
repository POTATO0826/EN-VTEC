import ResultsView from "@/components/results/ResultsView";

export const metadata = { title: "Results · VTEC" };

export default async function ResultsPage({ searchParams }: PageProps<"/results">) {
  const { sample } = await searchParams;
  return <ResultsView key={String(sample)} initialId={null} sample={sample === "1"} />;
}
