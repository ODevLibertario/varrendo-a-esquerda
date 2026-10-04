import configFile from "../config.json";
import parties from "../parties.json";
import { CRONS, collectPhase, electionConfig } from "./collector.mjs";

export default {
  async scheduled(controller, env) {
    const phase = CRONS.indexOf(controller.cron);
    if (phase < 0) throw new Error(`Agenda desconhecida: ${controller.cron}`);
    const result = await collectPhase({ kv: env.RESULTS, phase,
      config: electionConfig(configFile, env), parties });
    console.log(JSON.stringify({ event: "tse_collection", ...result }));
  },
};
