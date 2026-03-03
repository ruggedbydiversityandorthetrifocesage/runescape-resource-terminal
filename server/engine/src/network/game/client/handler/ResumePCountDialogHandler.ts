import Player from '#/engine/entity/Player.js';
import ScriptState from '#/engine/script/ScriptState.js';
import { pendingShopDialog, processRSTShopPurchase } from '#/engine/pill/RSTShop.js';
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

        if (!player.activeScript || player.activeScript.execution !== ScriptState.COUNTDIALOG) {
            return false;
        }

        player.activeScript.lastInt = input;
        player.executeScript(player.activeScript, true, true);
        return true;
    }
}
