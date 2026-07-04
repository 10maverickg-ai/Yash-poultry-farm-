import { notFound } from "next/navigation";
import { getSale } from "@/lib/eggstock";
import { SaleEditForm } from "@/components/SaleEditForm";

export const dynamic = "force-dynamic";

export default async function SaleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const saleId = Number(id);
  if (!Number.isInteger(saleId)) notFound();
  const sale = await getSale(saleId);
  if (!sale) notFound();

  return (
    <>
      <h1>Sale — {sale.buyer_or_recipient ?? sale.date}</h1>
      <SaleEditForm sale={sale} />
    </>
  );
}
