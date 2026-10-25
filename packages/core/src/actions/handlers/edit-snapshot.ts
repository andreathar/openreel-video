import type { Project } from "../../types/project";
import { registerActionHandler, createInverseAction } from "../registry";

/** Internal commit boundary. External documents must pass the portable validator. */
export type EditSnapshot = Pick<Project, "name" | "settings" | "timeline" | "mediaLibrary" | "textClips" | "shapeClips" | "svgClips" | "stickerClips" | "adjustmentLayers" | "masks" | "multicamGroups" | "compoundClips" | "nestedInstances" | "motionCompositions" | "motionInstances" | "generatedShaders" | "creation" | "production">;
export function editSnapshot(project: Project): EditSnapshot {
  const { name, settings, timeline, mediaLibrary, textClips, shapeClips, svgClips, stickerClips, adjustmentLayers, masks, multicamGroups, compoundClips, nestedInstances, motionCompositions, motionInstances, generatedShaders, creation, production } = project;
  return { name, settings, timeline, mediaLibrary, textClips, shapeClips, svgClips, stickerClips, adjustmentLayers, masks, multicamGroups, compoundClips, nestedInstances, motionCompositions, motionInstances, generatedShaders, creation, production };
}
registerActionHandler({
  type: "project/applyEditSnapshot",
  validate(action) { return action.params.snapshot && typeof action.params.snapshot === "object" ? { valid: true, errors: [] } : { valid: false, errors: [{ code: "INVALID_PARAMS", message: "Missing edit snapshot" }] }; },
  apply(action, project) {
    const snapshot = action.params.snapshot as EditSnapshot;
    const copied = { ...JSON.parse(JSON.stringify({ ...snapshot, mediaLibrary: undefined })), mediaLibrary: { items: snapshot.mediaLibrary.items.map((item) => ({ ...item })) } };
    Object.assign(project, copied, { modifiedAt: Date.now() });
    // JSON copy drops undefined keys, so restoring a snapshot taken before these existed must clear them.
    if (snapshot.production === undefined) delete (project as { production?: unknown }).production;
    if (snapshot.creation === undefined) delete (project as { creation?: unknown }).creation;
  },
  invert(action, before) { return createInverseAction(action, "project/applyEditSnapshot", { snapshot: editSnapshot(before) }); },
});
