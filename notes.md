### 1. claude said:

Boot sequence (synchronous, before first paint in index.ts):

1. Read all 4 keys from store (cache/localStorage — instant)
2. Set all 4 data-\* attributes on <html>
3. For mode: "auto", resolve via matchMedia("(prefers-color-scheme: dark)") and set the resolved value
4. Register media query listener for auto mode changes

Maybe we don't use js to resolve the prefers-color-scheme, and instead just leave it unset and let css handle.
