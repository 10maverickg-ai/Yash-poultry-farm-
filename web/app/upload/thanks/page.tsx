import Link from "next/link";

export const dynamic = "force-dynamic";

export const metadata = { title: "Uploaded" };

export default function ThanksPage() {
  return (
    <div className="card login-card">
      <h1 style={{ marginTop: 0 }}>Uploaded, thank you</h1>
      <p>Your photo is safely stored. You do not need to do anything else.</p>
      <p><Link href="/upload" className="btn">Upload another page</Link></p>
    </div>
  );
}
