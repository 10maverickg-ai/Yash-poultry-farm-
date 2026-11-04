// Plain steps for putting the website on a phone's home screen. No data, no JavaScript, shown on /install and on Settings.
export function InstallSteps() {
  return (
    <section className="card stack">
      <p style={{ margin: 0 }}>This is a website that can sit on your home screen like an app. There is nothing to download from a store.</p>
      <h3 style={{ margin: "0.4rem 0 0" }}>iPhone (Safari)</h3>
      <ol style={{ margin: 0, paddingLeft: "1.2rem" }}>
        <li>Open this website in <b>Safari</b> (not inside another app).</li>
        <li>Tap the <b>Share</b> button (the square with an arrow, at the bottom).</li>
        <li>Tap <b>Add to Home Screen</b>, then <b>Add</b>.</li>
      </ol>
      <h3 style={{ margin: "0.4rem 0 0" }}>Android (Chrome)</h3>
      <ol style={{ margin: 0, paddingLeft: "1.2rem" }}>
        <li>Open this website in <b>Chrome</b>.</li>
        <li>Tap <b>Install</b> if the app offers it, or open the <b>⋮</b> menu and tap <b>Install app</b> (or <b>Add to Home screen</b>).</li>
        <li>Tap <b>Install</b>.</li>
      </ol>
      <p className="muted an-tiny" style={{ margin: 0 }}>You will be asked for your password or PIN the first time. The phone then stays logged in.</p>
    </section>
  );
}
