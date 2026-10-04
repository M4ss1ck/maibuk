import { createRemoteElement } from "@remote-dom/core/elements";
export const UITextField = createRemoteElement({ properties: { value: {}, label: {} }, events: ["input"] });
export const UIText = createRemoteElement({});
export const UIListItem = createRemoteElement({ properties: { label: {} } });
