import { findIndex, remove } from 'lodash';
import eventEmitter from './events';
import AndroidDeviceManager from './AndroidDeviceManager';
import IOSDeviceManager from './IOSDeviceManager';
import log from './logger';
import schedule from 'node-schedule';
import SimulatorManager from './SimulatorManager';
import { isMac, checkIfPathIsAbsolute } from './helpers';

let actualDevices;
let instance = false;
let devices;

export default class Devices {
  constructor(devices) {
    actualDevices = devices;
  }
  emitConnectedDevices() {
    log.info('Starting & initializing the listen to device changes');
    let rule = new schedule.RecurrenceRule();
    rule.second = [0, 10, 20, 30, 40, 50];
    schedule.scheduleJob(rule, async function () {
      let androidDeviceManager = new AndroidDeviceManager();
      let iOSDeviceManager = new IOSDeviceManager();
      const connectedAndroidDevices = await androidDeviceManager.getDevices();
      const connectedIOSDevices = await iOSDeviceManager.getDevices();
      eventEmitter.emit('ConnectedDevices', {
        emittedDevices: Object.assign(
          connectedAndroidDevices,
          connectedIOSDevices
        ),
      });
    });
  }

  getFreeDevice(platform, options) {
    log.info(`Finding Free Device for Platform ${platform}`);
    if (options) {
      return actualDevices.find(
        (device) =>
          device.busy === false &&
          device.platform.toLowerCase() === platform &&
          device.name.includes(options.simulator)
      );
    } else {
      return actualDevices.find(
        (device) =>
          device.busy === false && device.platform.toLowerCase() === platform
      );
    }
  }

  blockDevice(freeDevice) {
    return actualDevices.find(
      (device) =>
        device.udid === freeDevice.udid && ((device.busy = true), true)
    );
  }

  unblockDevice(blockedDevice) {
    return actualDevices.find(
      (device) =>
        device.udid === blockedDevice.udid && ((device.busy = false), true)
    );
  }

  updateDevice(freeDevice, sessionId) {
    const device = actualDevices.find(
      (device) => device.udid === freeDevice.udid
    );
    const deviceIndex = findIndex(actualDevices, { udid: freeDevice.udid });
    actualDevices[deviceIndex] = Object.assign(device, { sessionId });
  }

  getDeviceForSession(sessionId) {
    return actualDevices.find((device) => device.sessionId === sessionId);
  }
}

export function isDeviceConfigPathAbsolute(path) {
  if (checkIfPathIsAbsolute(path)) {
    return true;
  } else {
    throw new Error(`Device Config Path ${path} should be absolute`);
  }
}

export function findUserSpecifiesDevices(userSpecifiedUDIDS, availableDevices) {
  let filteredDevices = [];
  userSpecifiedUDIDS.forEach((value) =>
    filteredDevices.push(
      availableDevices.find((device) => device.udid === value)
    )
  );
  return filteredDevices;
}

function fetchDevicesFromUDIDS(
  simulators,
  connectedAndroidDevices,
  connectedIOSDevices
) {
  const userSpecifiedUDIDS = process.env.UDIDS.split(',');
  const availableDevices = Object.assign(
    simulators,
    connectedAndroidDevices,
    connectedIOSDevices
  );
  const filteredDevices = findUserSpecifiesDevices(
    userSpecifiedUDIDS,
    availableDevices
  );
  return new Devices(filteredDevices);
}

export async function fetchDevices() {
  const udids = process.env.UDIDS;
  if (instance === false) {
    let simulators;
    let connectedIOSDevices;
    let connectedAndroidDevices;
    let simulatorManager = new SimulatorManager();
    let androidDevices = new AndroidDeviceManager();
    let iosDevices = new IOSDeviceManager();
    if (isMac()) {
      simulators = await simulatorManager.getSimulators();
      connectedIOSDevices = await iosDevices.getDevices();
      connectedAndroidDevices = await androidDevices.getDevices();
      if (udids) {
        devices = fetchDevicesFromUDIDS(
          simulators,
          connectedAndroidDevices,
          connectedIOSDevices
        );
      } else {
        devices = new Devices(
          Object.assign(
            simulators,
            connectedAndroidDevices,
            connectedIOSDevices
          )
        );
        devices.emitConnectedDevices();
      }
    } else {
      if (udids) {
        const userSpecifiedUDIDS = process.env.UDIDS.split(',');
        const availableDevices = await androidDevices.getDevices();
        const filteredDevices = findUserSpecifiesDevices(
          userSpecifiedUDIDS,
          availableDevices
        );
        devices = new Devices(filteredDevices);
      } else {
        devices = new Devices(await androidDevices.getDevices());
        devices.emitConnectedDevices();
      }
    }

    instance = true;
    eventEmitter.on('ConnectedDevices', function (data) {
      const { emittedDevices } = data;
      emittedDevices.forEach((emittedDevice) => {
        const actualDevice = actualDevices.find(
          (actualDeviceState) => actualDeviceState.udid === emittedDevice.udid
        );
        const deviceIndex = findIndex(emittedDevices, {
          udid: emittedDevice.udid,
        });
        emittedDevices[deviceIndex] = Object.assign({
          busy: !!actualDevice?.busy,
          state: emittedDevice.state,
          udid: emittedDevice.udid,
          sessionId: actualDevice?.sessionId ?? null,
          platform: emittedDevice.platform,
          realDevice: emittedDevice.realDevice,
          sdk: emittedDevice.sdk,
        });
      });
      remove(
        actualDevices,
        (device) =>
          device.platform === 'android' ||
          (device.platform === 'iOS' && device.realDevice === true)
      );
      actualDevices.push(...emittedDevices);
    });
  }
  return devices;
}

export function listAllDevices() {
  return actualDevices;
}
