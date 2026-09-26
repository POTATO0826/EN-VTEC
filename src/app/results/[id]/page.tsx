import ResultsView from "@/components/results/ResultsView";

export const metadata = { title: "Result · VTEC" };

// Where the tuner lands once verification ends: the same view, opened on one submission.
export default async function ResultPage({ params, searchParams }: PageProps<"/results/[id]">) {
  const [{ id }, { sample }] = await Promise.all([params, searchParams]);
  return <ResultsView key={`${id}:${sample}`} initialId={id} sample={sample === "1"} />;
}
