import VerificationView from "@/components/verify/VerificationView";

export const metadata = { title: "How it was verified · Opti-om" };

export default async function VerificationPage({ params }: PageProps<"/verify/[id]">) {
  const { id } = await params;
  return <VerificationView key={id} id={id} />;
}
