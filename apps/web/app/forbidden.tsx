export default function Forbidden(): React.JSX.Element {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-24 text-center">
      <p className="font-mono text-3xl font-semibold text-fg">403</p>
      <p className="text-sm text-fg-muted">Copilot 未对当前账号开放</p>
    </div>
  );
}
