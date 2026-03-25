### 1. claude said:

Boot sequence (synchronous, before first paint in index.ts):

1. Read all 4 keys from store (cache/localStorage — instant)
2. Set all 4 data-\* attributes on <html>
3. For mode: "auto", resolve via matchMedia("(prefers-color-scheme: dark)") and set the resolved value
4. Register media query listener for auto mode changes

Maybe we don't use js to resolve the prefers-color-scheme, and instead just leave it unset and let css handle.

### 2. Better settings

The key differentiator is upgraded controls throughout:

- Color options become proper swatches — filled circles with a check mark for the active one, not text buttons
- Mode becomes an icon-based segmented pill (sun / moon / auto) instead of three separate buttons
- Widget enables become toggle switches instead of checkboxes
- Each widget gets a subtle card-within-card treatment with its toggle in the top-right corner and sub-settings indented below
- The Appearance tab gets a live mini-preview strip at the top showing how the current theme/colors/mode look together
