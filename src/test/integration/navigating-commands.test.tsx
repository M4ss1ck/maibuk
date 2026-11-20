// The flagged half of the #319 navigating Commands suite, split for #851.
// The suite module registers the mocks, so it is imported first.
import { describeNavigatingCommands } from "@/test/integration/navigating-commands.suite";

describeNavigatingCommands("flagged");
