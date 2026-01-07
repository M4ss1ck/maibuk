export function Settings() {
  return (
    <div className="p-8 max-w-2xl">
      <h2 className="text-2xl font-semibold mb-8">Settings</h2>

      {/* Editor Settings */}
      <section className="mb-8">
        <h3 className="text-lg font-medium mb-4">Editor</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between py-2">
            <div>
              <p className="font-medium">Font Size</p>
              <p className="text-sm text-[var(--color-muted)]">Adjust the editor text size</p>
            </div>
            <select className="px-3 py-2 border border-[var(--color-border)] rounded-lg bg-transparent">
              <option value="14">Small</option>
              <option value="16">Medium</option>
              <option value="18" selected>Large</option>
              <option value="20">Extra Large</option>
            </select>
          </div>

          <div className="flex items-center justify-between py-2">
            <div>
              <p className="font-medium">Editor Font</p>
              <p className="text-sm text-[var(--color-muted)]">Choose your writing font</p>
            </div>
            <select className="px-3 py-2 border border-[var(--color-border)] rounded-lg bg-transparent">
              <option value="serif">Serif (Literata)</option>
              <option value="sans">Sans-serif (Inter)</option>
              <option value="mono">Monospace</option>
            </select>
          </div>

          <div className="flex items-center justify-between py-2">
            <div>
              <p className="font-medium">Auto-save</p>
              <p className="text-sm text-[var(--color-muted)]">Automatically save your work</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" className="sr-only peer" defaultChecked />
              <div className="w-11 h-6 bg-[var(--color-border)] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[var(--color-accent)]"></div>
            </label>
          </div>
        </div>
      </section>

      {/* Appearance Settings */}
      <section className="mb-8">
        <h3 className="text-lg font-medium mb-4">Appearance</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between py-2">
            <div>
              <p className="font-medium">Theme</p>
              <p className="text-sm text-[var(--color-muted)]">Choose your preferred theme</p>
            </div>
            <select className="px-3 py-2 border border-[var(--color-border)] rounded-lg bg-transparent">
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>
        </div>
      </section>

      {/* Export Settings */}
      <section className="mb-8">
        <h3 className="text-lg font-medium mb-4">Export Defaults</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between py-2">
            <div>
              <p className="font-medium">Default Format</p>
              <p className="text-sm text-[var(--color-muted)]">Preferred export format</p>
            </div>
            <select className="px-3 py-2 border border-[var(--color-border)] rounded-lg bg-transparent">
              <option value="epub">EPUB</option>
              <option value="pdf">PDF</option>
            </select>
          </div>
        </div>
      </section>

      {/* About */}
      <section>
        <h3 className="text-lg font-medium mb-4">About</h3>
        <div className="text-sm text-[var(--color-muted)]">
          <p>Maibuk v0.1.0</p>
          <p className="mt-1">A cross-platform writing app for authors</p>
        </div>
      </section>
    </div>
  );
}
