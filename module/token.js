/**
 * Custom TokenDocument so the Token HUD's HP bar can be edited directly on the
 * canvas (right-click a token → type a new HP value).
 *
 * Both actor types expose HP/HD through the derived path "computed.hp.bar" so a
 * single Token bar config works for PCs and NPCs. Foundry marks derived (non-
 * schema) bar attributes as non-editable, which greys out the HUD input. The
 * actor's `modifyTokenAttribute` override already redirects edits of that bar to
 * the real stored field (hp.current / hd.current, clamped), so it is safe to
 * force the bar editable here for anyone who owns the token (GM included).
 */
export class GodboundTokenDocument extends foundry.documents.TokenDocument {
    getBarAttribute(barName, options) {
        const data = super.getBarAttribute(barName, options);
        if (data && data.attribute === "computed.hp.bar") {
            data.editable = true;
        }
        return data;
    }
}
