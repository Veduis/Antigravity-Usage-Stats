# Guide to Packaging and Publishing Antigravity Usage Stats

It has been a while since your last release! This guide provides step-by-step instructions on how to package, verify, and publish **Version 0.3.3** of the **Antigravity Usage Stats** extension so your users get the compatibility update for **Antigravity 2.0**.

---

## 📦 Step 1: Packaging the Extension

The build pipeline compiles the TypeScript code and bundles it using `esbuild`. The packaging step then creates a `.vsix` file, which is the standard format for VS Code extensions.

To package the extension, run:
```bash
npm run build && npx vsce package
```

This creates a file named **`antigravity-usage-stats-0.3.3.vsix`** in the root of your project.

---

## 🧪 Step 2: Testing Locally Before Publishing

It is always a good practice to test the generated VSIX file locally inside your own IDE to verify that everything displays perfectly.

### In VS Code / Antigravity IDE:
1. Open the Extensions View (`Ctrl+Shift+X` or `Cmd+Shift+X`).
2. Click on the **`...`** (More Actions) button in the top-right of the extensions view.
3. Select **Install from VSIX...**
4. Locate and select `antigravity-usage-stats-0.3.3.vsix`.
5. Reload the window if prompted.

### Command Line Installation:
You can also install the packaged extension from your terminal:
```bash
# For standard VS Code:
code --install-extension antigravity-usage-stats-0.3.3.vsix

# For Antigravity (if the CLI is available):
antigravity --install-extension antigravity-usage-stats-0.3.3.vsix
```

---

## 🚀 Step 3: Publishing the Extension

Since Antigravity is a fork of VS Code, users generally obtain extensions from three main sources: the standard **Visual Studio Code Marketplace**, the **Open VSX Registry**, or **direct VSIX downloads**.

### Option A: Publishing to the VS Code Marketplace (Microsoft)

If you have already registered the publisher `Veduis` on the VS Code Marketplace:

1. **Get your Personal Access Token (PAT)** from [Azure DevOps](https://dev.azure.com/). Ensure the PAT has the "Marketplace (Publish)" scope.
2. **Login to vsce** via terminal (only needed if your login has expired):
   ```bash
   npx vsce login Veduis
   ```
   *It will prompt you for your Personal Access Token.*
3. **Publish the extension**:
   ```bash
   npx vsce publish
   ```
   *This automatically builds, packages, and uploads the new version.*

### Option B: Publishing to the Open VSX Registry (Eclipse Foundation)

Many alternative IDEs (like VSCodium or Antigravity's standalone client) default to the open-source **Open VSX Registry** instead of the proprietary Microsoft Marketplace.

1. Go to [open-vsx.org](https://open-vsx.org/) and log in.
2. Go to your **Profile** > **Access Tokens** and generate an Access Token.
3. Publish using `ovsx`:
   ```bash
   # Log in
   npx ovsx publish -t <YOUR_OPEN_VSX_TOKEN>
   ```

---

## 📂 Option C: Direct Distribution (GitHub Release)

Since it has been a while and some users prefer side-loading or manual installations in standalone clients like Antigravity 2.0:

1. Push your latest code changes to your repository.
2. Create a new git tag matching the version:
   ```bash
   git tag v0.3.3
   ```
3. Go to your GitHub repository and draft a **New Release**.
4. Set the tag version to `v0.3.3` and title it `v0.3.3 - Antigravity 2.0 Compatibility`.
5. Copy/paste the new changelog entries into the description.
6. **Drag and drop the `antigravity-usage-stats-0.3.3.vsix` file** into the release assets area.
7. Click **Publish Release**.

Users can then easily download the VSIX directly and follow the manual installation steps.
