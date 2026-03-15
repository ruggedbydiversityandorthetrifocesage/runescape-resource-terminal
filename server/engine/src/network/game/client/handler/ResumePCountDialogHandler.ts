import Player from '#/engine/entity/Player.js';
import ScriptState from '#/engine/script/ScriptState.js';
import { pendingShopDialog, processRSTShopPurchase, hasBobShopDialog, processBobShopPurchase, hasFishingShopDialog, processFishingShopPurchase } from '#/engine/pill/RSTShop.js';
import World from '#/engine/World.js';
import ClientGameMessageHandler from '#/network/game/client/ClientGameMessageHandler.js';
import ResumePCountDialog from '#/network/game/client/model/ResumePCountDialog.js';

export default class ResumePCountDialogHandler extends ClientGameMessageHandler<ResumePCountDialog> {
    handle(message: ResumePCountDialog, player: Player): boolean {
        const { input } = message;

        // RST Shop dialog intercept
        if (pendingShopDialog.has(player.username)) {
            pendingShopDialog.delete(player.username);
            processRSTShopPurchase(player, input, World.currentTick);
            return true;
        }

        // Bob's shop dialog intercept
        if (hasBobShopDialog(player.username)) {
            processBobShopPurchase(player as any, input);
            return true;
        }

        // Fishing Supplies NPC dialog intercept
        if (hasFishingShopDialog(player.username)) {
            processFishingShopPurchase(player as any, input);
            return true;
        }

        if (!player.activeScript || player.activeScript.execution !== ScriptState.COUNTDIALOG) {
            return false;
        }

        player.activeScript.lastInt = input;
        player.executeScript(player.activeScript, true, true);
        return true;
    }
}
