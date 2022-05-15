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
import { ResourceGroup, ResourceManagementClient } from "@azure/arm-resources";
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
const your_alias = "claoude";

// CHANGE THIS - used to add tags to resources
const project_name = "azure-samples-create-vm";

// Resource configs
const location = "eastus";
const account_type = "Standard_LRS";

// Ubuntu config for VM
const publisher = "Canonical";
const offer = "0001-com-ubuntu-server-focal";
const sku = "20_04-lts-gen2";
const admin_username = "notadmin";
const admin_password = "Pa$$w0rd92";

// Azure authentication in environment variables for DefaultAzureCredential
const tenantId = process.env["AZURE_TENANT_ID"];
const clientId = process.env["AZURE_CLIENT_ID"];
const secret = process.env["AZURE_CLIENT_SECRET"];
const subscriptionId = process.env["AZURE_SUBSCRIPTION_ID"];

if (!tenantId || !clientId || !secret || !subscriptionId) {
  throw new Error(
    "tenantId, clientId, secret, subscriptionId one of them are null/undefined"
  );
}

const credentials = new ClientSecretCredential(tenantId, clientId, secret);
// Azure services
const resourceClient = new ResourceManagementClient(
  credentials,
  subscriptionId
);
const compute_client = new ComputeManagementClient(credentials, subscriptionId);
const storage_client = new StorageManagementClient(credentials, subscriptionId);
const network_client = new NetworkManagementClient(credentials, subscriptionId);

function get_name_factory(id: string) {
  return (type: string) => `claoude${type}${id}`;
}

// Create resources then manage them (on/off)
export async function create_resources(id: string, user_id: string) {
  const get_name = get_name_factory(id);
  const tags = { user_id };
  const names = {
    resource_group: get_name("group"),
    storage_group: get_name("ac"),
    vnet: get_name("vnet"),
    subnet: get_name("subnet"),
    public_ip: get_name("pip"),
    public_ip_config: get_name("crpip"),
    domain: get_name("domainname"),
    network_interface: get_name("nic"),
    vm: get_name("vm"),
    disk: get_name("disk"),
  };

  try {
    await create_resource_group(names.resource_group, tags);
    await create_storage_account(
      names.resource_group,
      names.storage_group,
      tags
    );
    await create_vnet(names.resource_group, names.vnet, names.subnet, tags);
    subnetInfo = await get_subnet_info(
      names.resource_group,
      names.vnet,
      names.subnet
    );
    publicIPInfo = await create_public_ip(
      names.resource_group,
      names.public_ip,
      names.domain,
      tags
    );
    nicInfo = await create_nic(
      names.resource_group,
      names.network_interface,
      names.public_ip_config,
      subnetInfo,
      publicIPInfo,
      tags
    );

    if (!nicInfo?.id) throw new Error("no nic id found");
    vmImageInfo = await find_vm_image();
    await get_nic_info(names.resource_group, names.network_interface);
    await create_virtual_machine(
      names.resource_group,
      names.vm,
      names.disk,
      nicInfo.id,
      vmImageInfo[0].name,
      tags
    );
    return;
  } catch (err) {
    console.log(err);
  }
}

async function create_resource_group(
  resource_group_name: string,
  tags: Record<string, string>
) {
  console.log("\n1.Creating resource group: " + resource_group_name);
  const group_parameters: ResourceGroup = {
    location: location,
    tags,
  };
  const created_resource_group =
    await resourceClient.resourceGroups.createOrUpdate(
      resource_group_name,
      group_parameters
    );
  return created_resource_group;
}

async function create_storage_account(
  resource_group_name: string,
  storage_account_name: string,
  tags: Record<string, string>
) {
  console.log("\n2.Creating storage account: " + storage_account_name);
  const create_parameters = {
    location,
    sku: {
      name: account_type,
    },
    kind: "Storage",
    tags,
  };
  return await storage_client.storageAccounts.beginCreateAndWait(
    resource_group_name,
    storage_account_name,
    create_parameters
  );
}

async function create_vnet(
  resource_group_name: string,
  vnet_name: string,
  subnet_name: string,
  tags: Record<string, string>
) {
  console.log("\n3.Creating vnet: " + vnet_name);
  const vnet_parameters = {
    location: location,
    addressSpace: {
      addressPrefixes: ["10.0.0.0/16"],
    },
    dhcpOptions: {
      dnsServers: ["10.1.1.1", "10.1.2.4"],
    },
    subnets: [{ name: subnet_name, addressPrefix: "10.0.0.0/24" }],
    tags,
  };
  return await network_client.virtualNetworks.beginCreateOrUpdateAndWait(
    resource_group_name,
    vnet_name,
    vnet_parameters
  );
}

async function get_subnet_info(
  resource_group_name: string,
  vnet_name: string,
  subnet_name: string
): Promise<Subnet> {
  console.log("\nGetting subnet info for: " + subnet_name);
  return await network_client.subnets.get(
    resource_group_name,
    vnet_name,
    subnet_name
  );
}

async function create_public_ip(
  resource_group_name: string,
  public_ip_name: string,
  domain_name_label: string,
  tags: Record<string, string>
) {
  console.log("\n4.Creating public IP: " + public_ip_name);
  const public_ip_parameters = {
    location,
    publicIPAllocationMethod: "Dynamic",
    dnsSettings: {
      domainNameLabel: domain_name_label,
    },
    tags,
  };
  await network_client.publicIPAddresses.beginCreateOrUpdateAndWait(
    resource_group_name,
    public_ip_name,
    public_ip_parameters
  );
  return await network_client.publicIPAddresses.get(
    resource_group_name,
    public_ip_name
  );
}

async function create_nic(
  resource_group_name: string,
  network_interface_name: string,
  ip_config_name: string,
  subnet_info: Subnet,
  public_ip_info: PublicIPAddress,
  tags: Record<string, string>
) {
  console.log("\n5.Creating Network Interface: " + network_interface_name);
  const nic_parameters: NetworkInterface = {
    location,
    ipConfigurations: [
      {
        name: ip_config_name,
        privateIPAllocationMethod: "Dynamic",
        subnet: subnet_info,
        publicIPAddress: public_ip_info,
      },
    ],
    tags,
  };
  await network_client.networkInterfaces.beginCreateOrUpdateAndWait(
    resource_group_name,
    network_interface_name,
    nic_parameters
  );
  return await network_client.networkInterfaces.get(
    resource_group_name,
    network_interface_name
  );
}

async function find_vm_image() {
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
  const items = await compute_client.virtualMachineImages.list(
    location,
    publisher,
    offer,
    sku
  );
  const list_result: VirtualMachineImageResource[] = [];
  for (const item of items) {
    list_result.push(item);
  }
  return list_result;
}

async function get_nic_info(
  resource_group_name: string,
  network_interface_name: string
) {
  return await network_client.networkInterfaces.get(
    resource_group_name,
    network_interface_name
  );
}

async function create_virtual_machine(
  resource_group_name: string,
  vm_name: string,
  os_disk_name: string,
  nic_id: string,
  vm_image_version_number: string,
  tags: Record<string, string>
) {
  const vmParameters: VirtualMachine = {
    location,
    osProfile: {
      computerName: vm_name,
      adminUsername: admin_username,
      adminPassword: admin_password,
    },
    hardwareProfile: {
      vmSize: "Standard_B1ls",
    },
    storageProfile: {
      imageReference: {
        publisher: publisher,
        offer: offer,
        sku: sku,
        version: vm_image_version_number,
      },
      osDisk: {
        name: os_disk_name,
        caching: "ReadWrite",
        createOption: "fromImage",
      },
    },
    networkProfile: {
      networkInterfaces: [
        {
          id: nic_id,
          primary: true,
        },
      ],
    },
    tags,
  };
  console.log("6.Creating Virtual Machine: " + vm_name);
  console.log(
    " VM create parameters: " + util.inspect(vmParameters, { depth: null })
  );
  await compute_client.virtualMachines.beginCreateOrUpdateAndWait(
    resource_group_name,
    vm_name,
    vmParameters
  );
  return await compute_client.virtualMachines.get(resource_group_name, vm_name);
}

export async function delete_resources(id: string) {
  const get_name = get_name_factory(id);
  await resourceClient.resourceGroups.beginDelete(get_name("group"));
}
