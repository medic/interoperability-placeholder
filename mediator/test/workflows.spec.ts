import request from 'supertest';
import { OPENHIM, CHT, FHIR, OPENMRS } from '../config';
import {
  UserFactory, PatientFactory, TaskReportFactory, PlaceFactory, HeightWeightReportFactory,
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

const OPENMRS_APP_URL = 'http://localhost:8090/openmrs';
const OPENMRS_APP_USER = 'admin';
const OPENMRS_APP_PASSWORD = 'Admin123';

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
    const res = await request(OPENMRS_APP_URL)
      .post('/ws/rest/v1/patientidentifiertype')
      .auth(OPENMRS_APP_USER, OPENMRS_APP_PASSWORD)
      .send(patientIdType)
    if (res.status !== 201) {
      console.error('Response:', res);
      throw new Error(`create OpenMRS Id Type failed: Reason ${JSON.stringify(res.body || res)}`);
    }
  } catch (error) {
    throw new Error(`create OpenMRS Id Type failed ${error}`);
  }
};

const parentPlace = PlaceFactory.build();
let chwUserName: string;
let chwPassword: string;
let contactId: string;
let patientId: string;
let parentPlaceId: string;
let placeId: string;


const configureCHT = async () => {
  const createPlaceResponse = await request(CHT.url)
    .post('/api/v1/places')
    .auth(CHT.username, CHT.password)
    .send(parentPlace);

  if (createPlaceResponse.status === 200 && createPlaceResponse.body.ok === true) {
    parentPlaceId = createPlaceResponse.body.id;
  } else {
    throw new Error(`CHT place creation failed: Reason ${createPlaceResponse.status}`);
  }

  const user = UserFactory.build({}, { parentPlace: parentPlaceId });
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

  const retrieveChtHealthCenterResponse = await request(CHT.url)
        .get('/api/v2/users/maria')
        .auth(CHT.username, CHT.password);
  if (retrieveChtHealthCenterResponse.status === 200) {
    placeId = retrieveChtHealthCenterResponse.body.place[0]._id;
  } else {
    throw new Error(`CHT health center retrieval failed: Reason ${retrieveChtHealthCenterResponse.status}`);
  }
};

describe('Workflows', () => {

  beforeAll(async () => {
    await installMediatorConfiguration();
    await configureCHT();
    await new Promise((r) => setTimeout(r, 3000));
  });

  describe('OpenMRS workflow', () => {
    it('should follow the CHT Patient to OpenMRS workflow', async () => {
      await createOpenMRSIdType('CHT Patient ID');
      await createOpenMRSIdType('CHT Document ID');

      const checkMediatorResponse = await request(FHIR.url)
        .get('/mediator/')
        .auth(FHIR.username, FHIR.password);
      expect(checkMediatorResponse.status).toBe(200);
      expect(checkMediatorResponse.body.status).toBe('success');

      const patient = PatientFactory.build({name: 'CHTOpenMRS Patient', phone: '+2548277217095'}, { place: placeId });

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
      const retrieveUpdatedFhirPatientResponse = await request(FHIR.url)
      .get(`/fhir/Patient/${patientId}`)
      .auth(FHIR.username, FHIR.password);
      expect(retrieveUpdatedFhirPatientResponse.status).toBe(200);
      expect(retrieveUpdatedFhirPatientResponse.body.identifier).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
          value: openMrsPatientId,
          })
        ])
      );

      const searchOpenMrsPatientResponse = await request(OPENMRS.url)
        .get(`/Patient/?given=CHTOpenMRS&family=Patient`)
        .auth(OPENMRS.username, OPENMRS.password);
      expect(searchOpenMrsPatientResponse.status).toBe(200);
      expect(searchOpenMrsPatientResponse.body.total).toBe(1);
      expect(searchOpenMrsPatientResponse.body.entry[0].resource.id).toBe(openMrsPatientId);

      const heightWeightReport = HeightWeightReportFactory.build({}, { patientUuid: patientId});

      const submitHeightWeightReport = await request(CHT.url)
        .post('/api/v2/records')
        .auth(chwUserName, chwPassword)
        .send(heightWeightReport);

      expect(submitHeightWeightReport.status).toBe(200);

      await new Promise((r) => setTimeout(r, 2000));

      const retrieveFhirDbEncounter = await request(FHIR.url)
        .get('/fhir/Encounter/?subject=Patient/' + patientId)
        .auth(FHIR.username, FHIR.password);

      expect(retrieveFhirDbEncounter.status).toBe(200);
      expect(retrieveFhirDbEncounter.body.total).toBe(1);

      const retrieveFhirDbObservation = await request(FHIR.url)
        .get('/fhir/Observation/?subject=Patient/' + patientId)
        .auth(FHIR.username, FHIR.password);

      expect(retrieveFhirDbObservation.status).toBe(200);
      expect(retrieveFhirDbObservation.body.total).toBe(2);

      const triggerOpenMrsSyncEncounterResponse = await request(FHIR.url)
        .get('/mediator/openmrs/sync')
        .auth(FHIR.username, FHIR.password)
        .send();
      expect(triggerOpenMrsSyncEncounterResponse.status).toBe(200);

      await new Promise((r) => setTimeout(r, 2000));

      const retrieveOpenMrsEncounterResponse = await request(OPENMRS_APP_URL)
        .get('/ws/fhir2/R4/Encounter')
        .auth(OPENMRS_APP_USER, OPENMRS_APP_PASSWORD);
      expect(retrieveOpenMrsEncounterResponse.status).toBe(200);
      expect(retrieveOpenMrsEncounterResponse.body.total).toBe(1);

      const retrieveOpenMrsObservationResponse = await request(OPENMRS_APP_URL)
        .get('/ws/fhir2/R4/Observation')
        .auth(OPENMRS_APP_USER, OPENMRS_APP_PASSWORD);
      expect(retrieveOpenMrsObservationResponse.status).toBe(200);
      expect(retrieveOpenMrsObservationResponse.body.total).toBe(2);
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

      const patient = PatientFactory.build({}, { name: 'LTFU patient', place: placeId });

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

      const taskReport = TaskReportFactory.build({}, { placeId: placeId, contactId, patientId });

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
