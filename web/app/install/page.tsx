import { InstallSteps } from "@/components/InstallSteps";

export const dynamic = "force-dynamic";

export const metadata = { title: "Put the app on your phone" };

export default function InstallPage() {
  return (
    <>
      <h1>Put the app on your phone</h1>
      <InstallSteps />
    </>
  );
}
