import events from "node:events";
import type { ExtensionContext } from "../common/commands";
import type { DevicesManager } from "../devices/manager";
import type { iOSDeviceDestination } from "../devices/types";
import type { SimulatorsManager } from "../simulators/manager";
import type { SimulatorDestination, iOSSimulatorDestination, watchOSSimulatorDestination, visionOSSimulatorDestination } from "../simulators/types";
import { DESTINATION_TYPE_PRIORITY, SIMULATOR_TYPE_PRIORITY, SUPPORTED_DESTINATION_PLATFORMS } from "./constants";
import type { DestinationPlatform } from "./constants";
import {
  ALL_DESTINATION_TYPES,
  type Destination,
  type DestinationType,
  type SelectedDestination,
  macOSDestination,
} from "./types";
import { getMacOSArchitecture } from "./utils";

type IEventMap = {
  simulatorsUpdated: [];
  devicesUpdated: [];
  xcodeDestinationUpdated: [destination: SelectedDestination | undefined];
};

type IEventKey = keyof IEventMap;

export class DestinationsManager {
  private simulatorsManager: SimulatorsManager;
  private devicesManager: DevicesManager;
  private _context: ExtensionContext | undefined;

  // Event emitter to signal changes in the destinations
  private emitter = new events.EventEmitter<IEventMap>();

  constructor(options: { simulatorsManager: SimulatorsManager; devicesManager: DevicesManager }) {
    this.simulatorsManager = options.simulatorsManager;
    this.devicesManager = options.devicesManager;
    this._context = undefined;

    // Forward events from simulators and devices managers
    this.simulatorsManager.on("updated", () => {
      this.emitter.emit("simulatorsUpdated");
    });
    this.devicesManager.on("updated", () => {
      this.emitter.emit("devicesUpdated");
    });
  }

  on<K extends IEventKey>(event: K, listener: (...args: IEventMap[K]) => void): void {
    this.emitter.on(event, listener as any); // todo: fix this any
  }

  get context() {
    if (!this._context) {
      throw new Error("Context is not set");
    }
    return this._context;
  }

  set context(context: ExtensionContext) {
    this._context = context;
  }

  async refreshSimulators(): Promise<SimulatorDestination[]> {
    return await this.simulatorsManager.refresh();
  }

  async refreshiOSDevices() {
    await this.devicesManager.refresh();
  }

  async refresh() {
    await this.refreshSimulators();
    await this.refreshiOSDevices();
  }

  isUsageStatsExist(): boolean {
    return this.context.getWorkspaceState("build.xcodeDestinationsUsageStatistics") !== undefined;
  }

  async getMostUsedDestinations(): Promise<Destination[]> {
    const usageStats = this.context.getWorkspaceState("build.xcodeDestinationsUsageStatistics") ?? {};
    const destinationsIds = Object.keys(usageStats).sort((a, b) => usageStats[b] - usageStats[a]);
    const destinations: Destination[] = [];

    for (const destinationId of destinationsIds) {
      const destination = await this.findDestination({
        destinationId: destinationId,
      });
      if (destination) {
        destinations.push(destination);
      }
    }

    return destinations;
  }

  async getSimulators(options?: { sort?: boolean }): Promise<SimulatorDestination[]> {
    const simulators = await this.simulatorsManager.getSimulators();

    const items = [...simulators];
    if (options?.sort) {
      items.sort((a, b) => this.sortCompareFn(a, b));
    }
    return items;
  }

  async getiOSSimulators(options?: { sort?: boolean }): Promise<iOSSimulatorDestination[]> {
    const simulators = await this.simulatorsManager.getSimulators();
    const items = [...simulators];

    if (options?.sort) {
      items.sort((a, b) => this.sortCompareFn(a, b));
    }

    return items.filter((simulator) => simulator.type === "iOSSimulator");
  }

  async getVisionOSSimulators(): Promise<visionOSSimulatorDestination[]> {
    const simulators = await this.simulatorsManager.getSimulators();
    return simulators.filter((simulator) => simulator.type === "visionOSSimulator");
  }

  async getwatchOSSimulators(): Promise<watchOSSimulatorDestination[]> {
    const simulators = await this.simulatorsManager.getSimulators();
    return simulators.filter((simulator) => simulator.type === "watchOSSimulator");
  }

  async getiOSDevices(): Promise<iOSDeviceDestination[]> {
    const devices = await this.devicesManager.getDevices();
    return devices.filter((device) => device.type === "iOSDevice");
  }

  async getmacOSDevices(): Promise<macOSDestination[]> {
    const currentArch = getMacOSArchitecture() ?? "arm64";
    return [
      new macOSDestination({
        name: "My Mac",
        arch: currentArch,
      }),
    ];
  }

  /**
   * Function for sorting destinations. This function is not include sorting by usage statistics
   * bacause it's not needed in a lot of cases and should be done separately
   */
  sortCompareFn(a: Destination, b: Destination): number {
    const aPriority = DESTINATION_TYPE_PRIORITY.findIndex((type) => type === a.type);
    const bPriority = DESTINATION_TYPE_PRIORITY.findIndex((type) => type === b.type);
    if (aPriority !== bPriority) {
      return aPriority - bPriority;
    }

    // todo: sort ipad/iPhone/xorOS
    if (a.type === "iOSSimulator" && b.type === "iOSSimulator") {
      const aPriority = SIMULATOR_TYPE_PRIORITY.findIndex((type) => type === a.simulatorType);
      const bPriority = SIMULATOR_TYPE_PRIORITY.findIndex((type) => type === b.simulatorType);
      if (aPriority !== bPriority) {
        return aPriority - bPriority;
      }
    }

    // if (a.type === "iOSDevice" && b.type === "iOSDevice") {
    //   const aPriority = DESTINATION_IOS_DEVICE_TYPE_PRIORITY.findIndex((type) => type === a.deviceType);
    //   const bPriority = DESTINATION_IOS_DEVICE_TYPE_PRIORITY.findIndex((type) => type === b.deviceType);
    //   if (aPriority !== bPriority) {
    //     return aPriority - bPriority;
    //   }
    // }

    // In any other cases, fallback to sorting by name
    return a.name.localeCompare(b.name);
  }

  async getDestinations(options?: {
    platformFilter?: DestinationPlatform[];
    mostUsedSort?: boolean;
  }): Promise<Destination[]> {
    const destinations: Destination[] = [];

    const platforms = options?.platformFilter ?? SUPPORTED_DESTINATION_PLATFORMS;

    if (platforms.includes("iphonesimulator")) {
      const simulators = await this.getiOSSimulators();
      destinations.push(...simulators);
    }

    if (platforms.includes("watchsimulator")) {
      const simulators = await this.getwatchOSSimulators();
      destinations.push(...simulators);
    }

    if (platforms.includes("iphoneos")) {
      const devices = await this.getiOSDevices();
      destinations.push(...devices);
    }

    if (platforms.includes("macosx")) {
      const macosDevcices = await this.getmacOSDevices();
      destinations.push(...macosDevcices);
    }

    if (platforms.includes("xrsimulator")) {
      const simulators = await this.getVisionOSSimulators();
      destinations.push(...simulators);
    }

    // Most used destinations should be on top of the list
    if (options?.mostUsedSort) {
      const usageStats = this.context.getWorkspaceState("build.xcodeDestinationsUsageStatistics") ?? {};
      destinations.sort((a, b) => {
        const aCount = usageStats[a.id] ?? 0;
        const bCount = usageStats[b.id] ?? 0;
        if (aCount !== bCount) {
          return bCount - aCount;
        }
        return this.sortCompareFn(a, b);
      });
    }

    return destinations;
  }

  /**
   * Find a destination by its udid and type
   */
  async findDestination(options: {
    destinationId: string;
    type?: DestinationType;
  }): Promise<Destination | undefined> {
    const types: DestinationType[] = options.type ? [options.type] : ALL_DESTINATION_TYPES;

    let destination: Destination | undefined = undefined;
    if (!destination && types.includes("iOSSimulator")) {
      const simulators = await this.getiOSSimulators();
      destination = simulators.find((simulator) => simulator.id === options.destinationId);
    }
    if (!destination && types.includes("watchOSSimulator")) {
      const simulators = await this.getwatchOSSimulators();
      destination = simulators.find((simulator) => simulator.id === options.destinationId);
    }
    if (!destination && types.includes("iOSDevice")) {
      const devices = await this.getiOSDevices();
      destination = devices.find((device) => device.id === options.destinationId);
    }
    if (!destination && types.includes("macOS")) {
      const devices = await this.getmacOSDevices();
      destination = devices.find((device) => device.id === options.destinationId);
    }
    return destination;
  }

  /**
   * Increment the usage statistics for a destination. This statistics is used to show the most recently used
   * destinations
   */
  incrementUsageStats(options: { id: string }) {
    const prevStat = this.context.getWorkspaceState("build.xcodeDestinationsUsageStatistics") ?? {};
    const count: number = prevStat[options.id] ?? 0;
    this.context.updateWorkspaceState("build.xcodeDestinationsUsageStatistics", {
      ...prevStat,
      [options.id]: count + 1,
    });
  }

  setWorkspaceDestination(destination: Destination | undefined) {
    if (!destination) {
      this.context.updateWorkspaceState("build.xcodeDestination", undefined);
      this.emitter.emit("xcodeDestinationUpdated", undefined);
      return;
    }

    const selectedDestination: SelectedDestination = {
      id: destination.id,
      type: destination.type,
      name: destination.name,
    };
    this.context.updateWorkspaceState("build.xcodeDestination", selectedDestination);
    this.incrementUsageStats({ id: destination.id });

    this.emitter.emit("xcodeDestinationUpdated", selectedDestination);
  }

  /**
   * Get selected destination from the workspace state
   */
  getSelectedXcodeDestination(): SelectedDestination | undefined {
    return this.context.getWorkspaceState("build.xcodeDestination");
  }

  /*
   * Get selected destination from the workspace state. This function is async because it may need to
   * fetch the destination from the simulators and devices managers.
   */
  async findWorkspaceSelectedDestination(): Promise<Destination | undefined> {
    const destination = this.getSelectedXcodeDestination();
    if (!destination) {
      return undefined;
    }

    return await this.findDestination({
      destinationId: destination.id,
      type: destination.type,
    });
  }
}
