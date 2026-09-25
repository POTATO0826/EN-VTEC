import ResultView from "@/components/result/ResultView";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const tab = typeof query.tab === "string" ? query.tab : undefined;
  const live = query.live === "1";

  return <ResultView id={id} initialTab={tab} live={live} />;
}
