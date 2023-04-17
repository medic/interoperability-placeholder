import { Fhir } from "fhir";
import { FHIR } from "../../config";
import axios, { AxiosError } from "axios";

export const VALID_GENDERS = ["male", "female", "other", "unknown"] as const;

const { username, url, password } = FHIR;
const axiosOptions = {
  auth: {
    username,
    password,
  },
};

const fhir = new Fhir();

export function validateFhirResource(resourceType: string) {
  return function wrapper(data: any) {
    return fhir.validate({ ...data, resourceType });
  };
}

export function generateFHIRSubscriptionResource(
  patientId: string,
  callbackUrl: string
) {
  if (!patientId) {
    throw new Error(
      `Invalid patient id was expecting type of 'string' or 'number' but received '${typeof patientId}'`
    );
  } else if (!callbackUrl) {
    throw new Error(
      `Invalid 'callbackUrl' was expecting type of 'string' but recieved '${typeof callbackUrl}'`
    );
  }

  const FHIRSubscriptionResource = {
    resourceType: "Subscription",
    id: patientId,
    status: "requested",
    reason: "Follow up request for patient",
    criteria: `Encounter?identifier=${patientId}`,
    channel: {
      type: "rest-hook",
      endpoint: callbackUrl,
      payload: "application/fhir+json",
      header: ["Content-Type: application/fhir+json"],
    },
  };

  return FHIRSubscriptionResource;
}

export async function createFHIRSubscriptionResource(
  patientId: string,
  callbackUrl: string
) {
  const res = generateFHIRSubscriptionResource(patientId, callbackUrl);
  return await axios.post(`${url}/Subscription`, res, axiosOptions);
}

export async function getFHIROrgEndpointResource(id: string) {
  const organization = (
    await axios.get(`${url}/Organization/?identifier=${id}`, axiosOptions)
  ).data;

  const endpoints = organization.endpoint;

  if (!endpoints) {
    const error: any = new Error("Organization has no endpoint attached");
    error.status = 400;
    throw error;
  }

  const endpointRef = organization.endpoint[0];

  if (!endpointRef) {
    const error: any = new Error("Organization has no endpoint attached");
    error.status = 400;
    throw error;
  }

  const endpointId = endpointRef.identifier.value;

  return await axios.get(
    `${url}/Endpoint/?identifier=${endpointId}`,
    axiosOptions
  );
}

export async function getFHIRPatientResource(patientId: string) {
  return await axios.get(
    `${url}/Patient/?identifier=${patientId}`,
    axiosOptions
  );
}

export async function deleteFhirSubscription(id?: string) {
  return await axios.delete(`${url}/Subscription/${id}`, axiosOptions);
}
