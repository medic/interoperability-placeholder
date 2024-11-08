import request from 'supertest';
import { OPENHIM, CHT, FHIR, OPENMRS } from '../config';
import {
  UserFactory, PatientFactory, TaskReportFactory
} from './cht-resource-factories';
import {
  EndpointFactory as EndpointFactoryBase,
  OrganizationFactory as OrganizationFactoryBase,
  ServiceRequestFactory as ServiceRequestFactoryBase
} from '../src/middlewares/schemas/tests/fhir-resource-factories';
const { generateAuthHeaders } = require('../../configurator/libs/authentication');

jest.setTimeout(50000);

const EndpointFactory = EndpointFactoryBase.attr('status', 'active')
  .attr('address', 'https://interop.free.beeceptor.com/callback')
  .attr('payloadType', [{ text: 'application/json' }]);

const endpointIdentifier = 'test-endpoint';
const organizationIdentifier = 'test-org';
const OrganizationFactory = OrganizationFactoryBase.attr('identifier', [{ system: 'official', value: organizationIdentifier }]);

const ServiceRequestFactory = ServiceRequestFactoryBase.attr('status', 'active');

const installMediatorConfiguration = async () => {
  const authHeaders = await generateAuthHeaders({
    apiURL: OPENHIM.apiURL,
    username: OPENHIM.username,
    password: OPENHIM.password,
    rejectUnauthorized: false,
  });
  try {
    const res = await request(OPENHIM.apiURL)
      .post('/mediators/urn:mediator:cht-mediator/channels')
      .send(['Mediator'])
      .set('auth-username', authHeaders['auth-username'])
      .set('auth-ts', authHeaders['auth-ts'])
      .set('auth-salt', authHeaders['auth-salt'])
      .set('auth-token', authHeaders['auth-token']);

    if (res.status !== 201) {
      throw new Error(`Mediator channel installation failed: Reason ${res.status}`);
    }
  } catch (error) {
    throw new Error(`Mediator channel installation failed ${error}`);
  }
};

const createOpenMRSIdType = async (name: string) => {
  const patientIdType = {
    name: name,
    description: name,
    required: false,
    locationBehavior: "NOT_USED",
    uniquenessBehavior: "Unique"
  }
  try {
    const res = await request("http://localhost:8090")
      .post('/openmrs/ws/rest/v1/patientidentifiertype')
      .auth('admin', 'Admin123')
      .send(patientIdType)
    if (res.status !== 201) {
      console.error('Response:', res);
      throw new Error(`create OpenMRS Id Type failed: Reason ${JSON.stringify(res.body || res)}`);
    }
  } catch (error) {
    throw new Error(`create OpenMRS Id Type failed ${error}`);
  }
};

let placeId: string;
let chwUserName: string;
let chwPassword: string;
let contactId: string;
let patientId: string;

const configureCHT = async () => {
  const createPlaceResponse = await request(CHT.url)
    .post('/api/v1/places')
    .auth(CHT.username, CHT.password)
    .send({ 'name': 'CHP Branch Two', 'type': 'district_hospital' });

  if (createPlaceResponse.status === 200 && createPlaceResponse.body.ok === true) {
    placeId = createPlaceResponse.body.id;
  } else {
    throw new Error(`CHT place creation failed: Reason ${createPlaceResponse.status}`);
  }

  const user = UserFactory.build({}, { placeId: placeId });

  chwUserName = user.username;
  chwPassword = user.password;

  const createUserResponse = await request(CHT.url)
    .post('/api/v2/users')
    .auth(CHT.username, CHT.password)
    .send(user);
  if (createUserResponse.status === 200) {
    contactId = createUserResponse.body.contact.id;
  } else {
    throw new Error(`CHT user creation failed: Reason ${createUserResponse.status}`);
  }
};

describe('Workflows', () => {

  beforeAll(async () => {
    await installMediatorConfiguration();
    await configureCHT();
    await new Promise((r) => setTimeout(r, 3000));
    await createOpenMRSIdType('CHT Patient ID');
    await createOpenMRSIdType('CHT Document ID');
  });

  describe('OpenMRS workflow', () => {
    it('Should follow the CHT Patient to OpenMRS workflow', async () => {
      const checkMediatorResponse = await request(FHIR.url)
        .get('/mediator/')
        .auth(FHIR.username, FHIR.password);
      expect(checkMediatorResponse.status).toBe(200);
      expect(checkMediatorResponse.body.status).toBe('success');

      const patient = PatientFactory.build({name: 'OpenMRS Patient', phone: '+2548277217095'}, { placeId: placeId });

      const createPatientResponse = await request(CHT.url)
        .post('/api/v1/people')
        .auth(chwUserName, chwPassword)
        .send(patient);
      expect(createPatientResponse.status).toBe(200);
      expect(createPatientResponse.body.ok).toEqual(true);
      patientId = createPatientResponse.body.id;

      await new Promise((r) => setTimeout(r, 10000));

      const retrieveFhirPatientIdResponse = await request(FHIR.url)
        .get('/fhir/Patient/?identifier=' + patientId)
        .auth(FHIR.username, FHIR.password);
      expect(retrieveFhirPatientIdResponse.status).toBe(200);
      expect(retrieveFhirPatientIdResponse.body.total).toBe(1);

      const triggerOpenMrsSyncPatientResponse = await request(FHIR.url)
        .get('/mediator/openmrs/sync')
        .auth(FHIR.username, FHIR.password)
        .send();
      expect(triggerOpenMrsSyncPatientResponse.status).toBe(200);

      await new Promise((r) => setTimeout(r, 10000));

      const retrieveOpenMrsPatientIdResponse = await request(OPENMRS.url)
        .get('/Patient/?identifier=' + patientId)
        .auth(OPENMRS.username, OPENMRS.password);
      expect(retrieveOpenMrsPatientIdResponse.status).toBe(200);
      expect(retrieveOpenMrsPatientIdResponse.body.total).toBe(1);

      const openMrsPatientId = retrieveOpenMrsPatientIdResponse.body.entry[0].resource.id;
      console.log('openMrsPatientId: ' + openMrsPatientId);
      const retrieveUpdatedFhirPatientResponse = await request(FHIR.url)
      .get(`/fhir/Patient/${patientId}`)
      .auth(FHIR.username, FHIR.password);
      console.log('retrieveUpdatedFhirPatientResponse.body:');
      console.log(JSON.stringify(retrieveUpdatedFhirPatientResponse.body));
      expect(retrieveUpdatedFhirPatientResponse.status).toBe(200);
      expect(retrieveUpdatedFhirPatientResponse.body.identifier).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
          value: openMrsPatientId,
          })
        ])
      );

      const searchOpenMrsPatientResponse = await request(OPENMRS.url)
        .get(`/Patient/?given=OpenMRS&family=Patient`)
        .auth(OPENMRS.username, OPENMRS.password);
      expect(searchOpenMrsPatientResponse.status).toBe(200);
      expect(searchOpenMrsPatientResponse.body.total).toBe(1);
      expect(searchOpenMrsPatientResponse.body.entry[0].resource.id).toBe(openMrsPatientId);

      const searchOpenMrsPatientbyPhoneResponse = await request(OPENMRS.url)
        .get(`/Patient/?telecom.value=+2548277217095`)
        .auth(OPENMRS.username, OPENMRS.password);
      expect(searchOpenMrsPatientbyPhoneResponse.status).toBe(200);
      expect(searchOpenMrsPatientbyPhoneResponse.body.total).toBe(1);
      expect(searchOpenMrsPatientbyPhoneResponse.body.entry[0].resource.id).toBe(openMrsPatientId);
    });

    //skipping this test because is incomplete.
    it.skip('Should follow the OpenMRS Patient to CHT workflow', async () => {
      const checkMediatorResponse = await request(FHIR.url)
        .get('/mediator/')
        .auth(FHIR.username, FHIR.password);

      expect(checkMediatorResponse.status).toBe(200);

      //TODO: Create a patient using openMRS api

      const retrieveFhirPatientIdResponse = await request(FHIR.url)
        .get('/fhir/Patient/?identifier=' + patientId)
        .auth(FHIR.username, FHIR.password);

      expect(retrieveFhirPatientIdResponse.status).toBe(200);
      //expect(retrieveFhirPatientIdResponse.body.total).toBe(1);

      //TODO: retrieve and validate patient from CHT api
      //trigger openmrs sync
      //validate id
    });
  });

  describe('Loss To Follow-Up (LTFU) workflow', () => {
    let encounterUrl: string;
    let endpointId: string;

    it('Should follow the LTFU workflow', async () => {
      const checkMediatorResponse = await request(FHIR.url)
        .get('/mediator/')
        .auth(FHIR.username, FHIR.password);

      expect(checkMediatorResponse.status).toBe(200);
      expect(checkMediatorResponse.body.status).toBe('success');

      const identifier = [{ system: 'official', value: endpointIdentifier }];
      const endpoint = EndpointFactory.build({ identifier: identifier });
      const createMediatorEndpointResponse = await request(FHIR.url)
        .post('/mediator/endpoint')
        .auth(FHIR.username, FHIR.password)
        .send(endpoint);

      expect(createMediatorEndpointResponse.status).toBe(201);
      endpointId = createMediatorEndpointResponse.body.id;

      const retrieveEndpointResponse = await request(FHIR.url)
        .get('/fhir/Endpoint/?identifier=' + endpointIdentifier)
        .auth(FHIR.username, FHIR.password);

      expect(retrieveEndpointResponse.status).toBe(200);
      expect(retrieveEndpointResponse.body.total).toBe(1);

      const organization = OrganizationFactory.build();
      organization.endpoint[0].reference = `Endpoint/${endpointId}`;

      const createMediatorOrganizationResponse = await request(FHIR.url)
        .post('/mediator/organization')
        .auth(FHIR.username, FHIR.password)
        .send(organization);

      expect(createMediatorOrganizationResponse.status).toBe(201);

      const retrieveOrganizationResponse = await request(FHIR.url)
        .get('/fhir/Organization/?identifier=' + organizationIdentifier)
        .auth(FHIR.username, FHIR.password);

      expect(retrieveOrganizationResponse.status).toBe(200);
      expect(retrieveOrganizationResponse.body.total).toBe(1);

      const patient = PatientFactory.build({}, { name: 'LTFU patient', placeId: placeId });

      const createPatientResponse = await request(CHT.url)
        .post('/api/v1/people')
        .auth(chwUserName, chwPassword)
        .send(patient);

      expect(createPatientResponse.status).toBe(200);
      expect(createPatientResponse.body.ok).toEqual(true);
      patientId = createPatientResponse.body.id;

      await new Promise((r) => setTimeout(r, 3000));

      const retrieveFhirPatientIdResponse = await request(FHIR.url)
        .get('/fhir/Patient/?identifier=' + patientId)
        .auth(FHIR.username, FHIR.password);

      expect(retrieveFhirPatientIdResponse.status).toBe(200);
      expect(retrieveFhirPatientIdResponse.body.total).toBe(1);

      const serviceRequest = ServiceRequestFactory.build();
      serviceRequest.subject.reference = `Patient/${patientId}`;
      serviceRequest.requester.reference = `Organization/${organizationIdentifier}`;

      const sendMediatorServiceRequestResponse = await request(FHIR.url)
        .post('/mediator/service-request')
        .auth(FHIR.username, FHIR.password)
        .send(serviceRequest);
      expect(sendMediatorServiceRequestResponse.status).toBe(201);
      encounterUrl = sendMediatorServiceRequestResponse.body.criteria;

      const taskReport = TaskReportFactory.build({}, { placeId, contactId, patientId });

      const submitChtTaskResponse = await request(CHT.url)
        .post('/medic/_bulk_docs')
        .auth(chwUserName, chwPassword)
        .send(taskReport);

      expect(submitChtTaskResponse.status).toBe(201);

      await new Promise((r) => setTimeout(r, 2000));

      const retrieveFhirDbEncounter = await request(FHIR.url)
        .get('/fhir/' + encounterUrl)
        .auth(FHIR.username, FHIR.password);

      expect(retrieveFhirDbEncounter.status).toBe(200);
      expect(retrieveFhirDbEncounter.body.total).toBe(1);
    });
  });
});
