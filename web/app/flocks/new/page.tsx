import { listSheds } from "@/lib/flocks";
import { FlockNewForm } from "@/components/FlockNewForm";

export const dynamic = "force-dynamic";

export default async function NewFlockPage() {
  const sheds = await listSheds();

  return (
    <>
      <h1>New flock</h1>
      <FlockNewForm shedCodes={sheds.map((s) => s.shed_code)} />
    </>
  );
}
