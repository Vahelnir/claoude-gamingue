import "dotenv/config";
import * as util from "util";
import {
  ClientSecretCredential,
  DefaultAzureCredential,
} from "@azure/identity";
import {
  ComputeManagementClient,
  VirtualMachine,
  VirtualMachineImageResource,
} from "@azure/arm-compute";
import { ResourceManagementClient } from "@azure/arm-resources";
import { StorageManagementClient } from "@azure/arm-storage";
import {
  NetworkInterface,
  NetworkManagementClient,
  PublicIPAddress,
  Subnet,
} from "@azure/arm-network";

// Store function output to be used elsewhere
let randomIds = {};
let subnetInfo = null;
let publicIPInfo = null;
let vmImageInfo = null;
let nicInfo = null;

// CHANGE THIS - used as prefix for naming resources
const yourAlias = "claoude";

// CHANGE THIS - used to add tags to resources
const projectName = "azure-samples-create-vm";

// Resource configs
const location = "eastus";
const accType = "Standard_LRS";

// Ubuntu config for VM
const publisher = "Canonical";
const offer = "0001-com-ubuntu-server-focal";
const sku = "20_04-lts-gen2";
const adminUsername = "notadmin";
const adminPassword = "Pa$$w0rd92";

// Azure authentication in environment variables for DefaultAzureCredential
const tenantId = process.env["AZURE_TENANT_ID"];
const clientId = process.env["AZURE_CLIENT_ID"];
const secret = process.env["AZURE_CLIENT_SECRET"];
const subscriptionId = process.env["AZURE_SUBSCRIPTION_ID"];

let credentials = null;

if (!tenantId || !clientId || !secret || !subscriptionId) {
  throw new Error(
    "tenantId, clientId, secret, subscriptionId one of them are null/undefined"
  );
}

if (process.env.production) {
  // production
  credentials = new DefaultAzureCredential();
} else {
  // development
  credentials = new ClientSecretCredential(tenantId, clientId, secret);
  console.log("development");
}
// Azure services
const resourceClient = new ResourceManagementClient(
  credentials,
  subscriptionId
);
const computeClient = new ComputeManagementClient(credentials, subscriptionId);
const storageClient = new StorageManagementClient(credentials, subscriptionId);
const diskClient = new StorageManagementClient(credentials, subscriptionId);
const networkClient = new NetworkManagementClient(credentials, subscriptionId);

// Create resources then manage them (on/off)
async function createResources() {
  try {
    const result = await createResourceGroup();
    const accountInfo = await createStorageAccount();
    const vnetInfo = await createVnet();
    subnetInfo = await getSubnetInfo();
    publicIPInfo = await createPublicIP();
    nicInfo = await createNIC(subnetInfo, publicIPInfo);

    if (!nicInfo?.id) throw new Error("no nic id found");
    vmImageInfo = await findVMImage();
    const nicResult = await getNICInfo();
    // const os_disk = await create_disk();
    const vmInfo = await createVirtualMachine(nicInfo.id, vmImageInfo[0].name);
    return;
  } catch (err) {
    console.log(err);
  }
}

async function create_disk() {
  return await computeClient.disks.beginCreateOrUpdateAndWait(
    resourceGroupName,
    osDiskName,
    { location }
  );
}

async function createResourceGroup() {
  console.log("\n1.Creating resource group: " + resourceGroupName);
  const groupParameters = {
    location: location,
    tags: { project: projectName },
  };
  const resCreate = await resourceClient.resourceGroups.createOrUpdate(
    resourceGroupName,
    groupParameters
  );
  return resCreate;
}

async function createStorageAccount() {
  console.log("\n2.Creating storage account: " + storageAccountName);
  const createParameters = {
    location,
    sku: {
      name: accType,
    },
    kind: "Storage",
    tags: {
      project: projectName,
    },
  };
  return await storageClient.storageAccounts.beginCreateAndWait(
    resourceGroupName,
    storageAccountName,
    createParameters
  );
}

async function createVnet() {
  console.log("\n3.Creating vnet: " + vnetName);
  const vnetParameters = {
    location: location,
    addressSpace: {
      addressPrefixes: ["10.0.0.0/16"],
    },
    dhcpOptions: {
      dnsServers: ["10.1.1.1", "10.1.2.4"],
    },
    subnets: [{ name: subnetName, addressPrefix: "10.0.0.0/24" }],
  };
  return await networkClient.virtualNetworks.beginCreateOrUpdateAndWait(
    resourceGroupName,
    vnetName,
    vnetParameters
  );
}

async function getSubnetInfo(): Promise<Subnet> {
  console.log("\nGetting subnet info for: " + subnetName);
  const getResult = await networkClient.subnets.get(
    resourceGroupName,
    vnetName,
    subnetName
  );
  return getResult;
}

async function createPublicIP() {
  console.log("\n4.Creating public IP: " + publicIPName);
  const publicIPParameters = {
    location,
    publicIPAllocationMethod: "Dynamic",
    dnsSettings: {
      domainNameLabel: domainNameLabel,
    },
  };
  await networkClient.publicIPAddresses.beginCreateOrUpdateAndWait(
    resourceGroupName,
    publicIPName,
    publicIPParameters
  );
  return await networkClient.publicIPAddresses.get(
    resourceGroupName,
    publicIPName
  );
}

async function createNIC(subnetInfo: Subnet, publicIPInfo: PublicIPAddress) {
  console.log("\n5.Creating Network Interface: " + networkInterfaceName);
  console.log(publicIPInfo);
  const nicParameters: NetworkInterface = {
    location,
    ipConfigurations: [
      {
        name: ipConfigName,
        privateIPAllocationMethod: "Dynamic",
        subnet: subnetInfo,
        publicIPAddress: publicIPInfo,
      },
    ],
  };
  await networkClient.networkInterfaces.beginCreateOrUpdateAndWait(
    resourceGroupName,
    networkInterfaceName,
    nicParameters
  );
  return await networkClient.networkInterfaces.get(
    resourceGroupName,
    networkInterfaceName
  );
}

async function findVMImage() {
  console.log(
    util.format(
      "\nFinding a VM Image for location %s from " +
        "publisher %s with offer %s and sku %s",
      location,
      publisher,
      offer,
      sku
    )
  );
  const items = await computeClient.virtualMachineImages.list(
    location,
    publisher,
    offer,
    sku
  );
  const listResult: VirtualMachineImageResource[] = [];
  for (const item of items) {
    listResult.push(item);
  }
  return listResult;
}

async function getNICInfo() {
  return await networkClient.networkInterfaces.get(
    resourceGroupName,
    networkInterfaceName
  );
}

async function createVirtualMachine(
  nicId: string,
  vmImageVersionNumber: string
) {
  const vmParameters: VirtualMachine = {
    location,
    osProfile: {
      computerName: vmName,
      adminUsername: adminUsername,
      adminPassword: adminPassword,
    },
    hardwareProfile: {
      vmSize: "Standard_B1ls",
    },
    storageProfile: {
      imageReference: {
        publisher: publisher,
        offer: offer,
        sku: sku,
        version: vmImageVersionNumber,
      },
      osDisk: {
        name: osDiskName,
        caching: "ReadWrite",
        createOption: "fromImage",
      },
    },
    networkProfile: {
      networkInterfaces: [
        {
          id: nicId,
          primary: true,
        },
      ],
    },
  };
  console.log("6.Creating Virtual Machine: " + vmName);
  console.log(
    " VM create parameters: " + util.inspect(vmParameters, { depth: null })
  );
  const resCreate =
    await computeClient.virtualMachines.beginCreateOrUpdateAndWait(
      resourceGroupName,
      vmName,
      vmParameters
    );
  return await computeClient.virtualMachines.get(resourceGroupName, vmName);
}

const _generateRandomId = (
  prefix: string,
  existIds: Record<string, unknown>
) => {
  var newNumber;
  while (true) {
    newNumber = prefix + Math.floor(Math.random() * 10000);
    if (!existIds || !(newNumber in existIds)) {
      break;
    }
  }
  return newNumber;
};

//Random number generator for service names and settings
const resourceGroupName = _generateRandomId(`${yourAlias}-testrg`, randomIds);
const vmName = _generateRandomId(`${yourAlias}vm`, randomIds);
const storageAccountName = _generateRandomId(`${yourAlias}ac`, randomIds);
const vnetName = _generateRandomId(`${yourAlias}vnet`, randomIds);
const subnetName = _generateRandomId(`${yourAlias}subnet`, randomIds);
const publicIPName = _generateRandomId(`${yourAlias}pip`, randomIds);
const networkInterfaceName = _generateRandomId(`${yourAlias}nic`, randomIds);
const ipConfigName = _generateRandomId(`${yourAlias}crpip`, randomIds);
const domainNameLabel = _generateRandomId(`${yourAlias}domainname`, randomIds);
const osDiskName = _generateRandomId(`${yourAlias}osdisk`, randomIds);

async function main() {
  await createResources();
}

main()
  .then(() => {
    console.log(
      `success - resource group name: ${resourceGroupName}, vm resource name: ${vmName}`
    );
  })
  .catch((err) => {
    console.log(err);
  });
