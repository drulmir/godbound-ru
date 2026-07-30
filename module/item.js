/**
 * Extend the basic Item with some very simple modifications.
 * @extends {Item}
 */
export class GodboundItem extends Item {

    /**
     * Binding an artifact permanently commits one point of the owning actor's
     * at-will Effort; unbinding refunds it. Keeping this coupled to the `bound`
     * flag makes that flag the single source of truth no matter how it's toggled
     * (the "Связать" button on the actor sheet or the checkbox on the artifact
     * sheet), so the Effort accounting can never drift out of sync.
     */
    async _preUpdate(changed, options, user) {
        if (this.type === 'artifact') {
            const nextBound = foundry.utils.getProperty(changed, 'system.bound');
            if (typeof nextBound === 'boolean' && nextBound !== this.system.bound) {
                // Re-entrancy guard: if a bind/unbind toggle for this artifact is
                // already committing its Effort, veto a second rapid toggle so two
                // clicks can't both pass canSpendEffort and double-commit the pool.
                if (this._gbBindInFlight) return false;
                const actor = this.actor;
                if (actor) {
                    this._gbBindInFlight = true;
                    try {
                        if (nextBound) {
                            if (!actor.canSpendEffort(1)) {
                                return false; // not enough free Effort - veto the bind
                            }
                            await actor.update({system: {effort: {atWill: (actor.system.effort.atWill || 0) + 1}}});
                        } else {
                            const cur = actor.system.effort?.atWill || 0;
                            await actor.update({system: {effort: {atWill: Math.max(0, cur - 1)}}});
                        }
                    } finally {
                        this._gbBindInFlight = false;
                    }
                }
            }
        }
        return super._preUpdate(changed, options, user);
    }

    /**
     * Augment the basic Item data model with additional dynamic data.
     */
    prepareData() {
        super.prepareData();

        const data = this.system;
        data.computed = {};

        if (this.type === 'artifact') this._prepareArtifactData();
        if (this.type === 'project') this._prepareProjectData();
        if (this.type === 'cult') this._prepareCultData();
        if (this.type === 'boundWord') this._prepareBoundWordData();

        // How much Effort this item is currently holding, used by the "return Effort"
        // dialog on the actor sheet. Artifacts are excluded on purpose: their
        // atWill/scene/day is the pool their own powers draw FROM, not an investment
        // the artifact itself made.
        if (this.type !== 'artifact' && data.effort && ('atWill' in data.effort)) {
            data.computed.effortHeld = (Number(data.effort.atWill) || 0)
                + (Number(data.effort.scene) || 0)
                + (Number(data.effort.day) || 0);
        }

        if (data.damageRoll) {
            if (!data.damageBonus) {
                data.computed.damageFormula = `${data.damageRoll}`;
            } else if (data.damageBonus < 0) {
                data.computed.damageFormula = `${data.damageRoll}${data.damageBonus}`;
            } else {
                data.computed.damageFormula = `${data.damageRoll}+${data.damageBonus}`;
            }
        }
    }

    _prepareArtifactData() {
        const data = this.system;
        data.computed = {};
        data.computed.effort = {};
        data.computed.effort.available =
            data.effort.total - (
                data.effort.atWill +
                data.effort.scene +
                data.effort.day
            )
        ;
        data.computed.effort.spent = data.effort.total - data.computed.effort.available;
        data.computed.remaining = data.dominionCost - (data.committedDominion + data.contributedDominion);
    }

    _prepareProjectData() {
        const data = this.system;
        data.computed = {};
        data.computed.cost = (data.scope + data.resistance) * data.difficulty;
        data.computed.remaining = data.computed.cost - (
            data.committedDominion + data.committedInfluence + data.contributedDominion + data.contributedInfluence
        );
    }

    _prepareCultData() {
        const data = this.system;
        const maxTroubles = [1, 6, 8, 10, 12, 20]
        data.computed = {};
        data.computed.maxTrouble = maxTroubles[data.power] || 1;
    }

    _prepareBoundWordData() {
        const data = this.system;
        if (!data.effort) data.effort = {atWill: 0, scene: 0, day: 0};
        data.computed = {};
        data.computed.effortSpent = (data.effort.atWill || 0) + (data.effort.scene || 0) + (data.effort.day || 0);
    }

    canSpendEffort(amount) {
        if (this.type !== 'artifact') {
            ui.notifications.warn("Предмет не питается Усилием");
            return false;
        }
        if (this.system.computed.effort.available >= amount) {
            return true;
        } else {
            ui.notifications.warn("Недостаточно Усилия в предмете");
            return false;
        }
    }

    getCommitmentOptions() {
        let options = [];
        if(this.system.noEffort) {
            options.push({id: 'noEffort', name: 'Без Усилия', actorFnRef: 'demonstratePower', iClass: 'far fa-play-circle'});
        }
        if(this.system.atWill) {
            options.push({id: 'atWill', name: 'По желанию', actorFnRef: 'commitEffortAtWill', iClass: 'fas fa-power-off'});
        }
        if(this.system.scene) {
            options.push({id: 'scene', name: 'На сцену', actorFnRef: 'commitEffortForScene', iClass: 'fas fa-clock'});
        }
        if(this.system.day) {
            options.push({id: 'day', name: 'На день', actorFnRef: 'commitEffortForDay', iClass: 'fas fa-sun'});
        }
        return options;
    }
}
