import { randomUUID } from 'crypto';
import { Factory } from 'rosie';

export const OpenMRSPatientFactory = new Factory()
  .option('placeId')
  .attr('resourceType', 'Patient')
  .attr('id', () => randomUUID())
  .attr('meta', () => ({
    versionId: '2',
    lastUpdated: new Date().toISOString(),
    source: 'cht#rjEgeBRWROBrChB7'
  }))
  .attr('text', () => ({
    status: 'generated',
    div: '<div xmlns="http://www.w3.org/1999/xhtml"><div class="hapiHeaderText">OpenMRS <b>PATIENT </b></div><table class="hapiPropertyTable"><tbody><tr><td>Identifier</td><td>52802</td></tr><tr><td>Date of birth</td><td><span>06 June 1980</span></td></tr></tbody></table></div>'
  }))
  .attr('identifier', () => [
    {
      id: randomUUID(),
      use: 'official',
      type: { text: 'CHT Patient ID' },
      value: Math.floor(Math.random() * 100000).toString()
    },
    {
      id: randomUUID(),
      use: 'secondary',
      type: { text: 'CHT Document ID' },
      value: randomUUID()
    },
    {
      id: randomUUID(),
      use: 'secondary',
      type: { text: 'OpenMRS Patient UUID' },
      value: randomUUID()
    }
  ])
  .attr('name', () => [
    {
      id: randomUUID(),
      family: 'Patient',
      given: ['OpenMRS']
    }
  ])
  .attr('telecom', () => [
    {
      id: randomUUID(),
      value: '+2548277217095'
    }
  ])
  .attr('gender', 'male')
  .attr('birthDate', '1980-06-06')
  .attr('address', ['placeId'], (placeId) => [
    {
      id: randomUUID(),
      line: ['123 Main St'],
      city: 'Nairobi',
      country: 'Kenya',
      extension: [{
        extension: [
          {
            url: 'http://fhir.openmrs.org/ext/address#address4',
            valueString: `FCHV Area [${placeId}]`
          }
        ]
      }]
    }
  ]);
