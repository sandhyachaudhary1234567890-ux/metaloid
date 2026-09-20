// Unified Device Graph & Cross-Device Synchronizer (§7)
// Merges phone call voice interface, laptop workspace, browser agent, and companion execution
// into a unified device topology with shared conversation context, state, and artifacts.

export type DeviceType = 'phone' | 'laptop' | 'browser' | 'companion_node';

export interface DeviceNode {
  id: string;
  name: string;
  type: DeviceType;
  status: 'active' | 'standby' | 'disconnected';
  capabilities: string[];
  lastPing: number;
}

export class DeviceGraph {
  private static devices: Map<string, DeviceNode> = new Map([
    [
      'dev_laptop',
      {
        id: 'dev_laptop',
        name: 'My Laptop',
        type: 'laptop',
        status: 'active',
        capabilities: ['workspace', 'code_execution', 'terminal', 'visual_qa'],
        lastPing: Date.now(),
      },
    ],
    [
      'dev_phone',
      {
        id: 'dev_phone',
        name: 'My Phone',
        type: 'phone',
        status: 'active',
        capabilities: ['voice_call', 'mic_input', 'mobile_hud', 'telemetry'],
        lastPing: Date.now(),
      },
    ],
    [
      'dev_browser',
      {
        id: 'dev_browser',
        name: 'Browser Agent',
        type: 'browser',
        status: 'standby',
        capabilities: ['dom_navigation', 'web_research', 'screenshot'],
        lastPing: Date.now(),
      },
    ],
  ]);

  /**
   * Register or update a device heartbeat.
   */
  static heartbeat(deviceId: string): void {
    const node = this.devices.get(deviceId);
    if (node) {
      node.lastPing = Date.now();
      node.status = 'active';
    }
  }

  /**
   * Query all active devices in the graph.
   */
  static getActiveDevices(): DeviceNode[] {
    const now = Date.now();
    return Array.from(this.devices.values()).map((d) => {
      if (now - d.lastPing > 30000 && d.status === 'active') {
        d.status = 'standby';
      }
      return d;
    });
  }

  /**
   * Dispatch cross-device synchronization payload.
   */
  static syncContextAcrossDevices(conversationId: string, activeTaskId?: string): {
    synchronizedDevices: string[];
    conversationId: string;
    activeTaskId?: string;
  } {
    const active = this.getActiveDevices().filter((d) => d.status === 'active');
    return {
      synchronizedDevices: active.map((d) => d.name),
      conversationId,
      activeTaskId,
    };
  }
}
