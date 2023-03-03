# Infrastructure for Community of Practice (CoP) Interoperability Project

## Overview
This project implements a Loss to Follow Up (LTFU) workflow system for CHIS based on [OpenHIE LTFU Guide](https://wiki.ohie.org/display/SUB/Use+Case+Summary:+Request+Community+Based+Follow-Up).

A first version of the project can be found in the [chis-interoperability](https://github.com/medic/chis-interoperability) repository.

## Prerequisites
- `docker`

## Get Started

1. Run `./startup.sh init` to start-up the docker containers on the first run or after calling `./startup.sh destroy`. Use `./startup.sh up` for subsequent runs after calling `init` without calling `destroy`.

1. Visit http://localhost:9000 and login with the following credentials email: `interop@openhim.org` and password: `interop-password`. The default User username for OpenHIM is `interop@openhim.org` and password is `interop-password`. The default Client username is `interop-client` and password is `interop-password`.

1. Once logged in, visit http://localhost:9000/#!/mediators and select the only mediator with the `Name` 'Loss to Follow Up Mediator'.

1. Select the green `+` button to the right of the default channel to add the mediator.

1. You can test the mediator by running `curl -X GET http://localhost:5001/mediator -H "Authorization: Basic $(echo -n interop-client:interop-password | base64)"`. You should get the following response `{"status": "success" }`.

1. If the curl request fails, visit http://localhost:9000/#!/clients and click on the icon the red arrow points to in the image below.

![](./docs/images/bad-client-screen.png) If everything is successful you should see this ![](./docs/images/good-client-screen.png)

## Loading CHT configuration
1. Go into the `cht-config` directory by running `cd cht-config`.
1. Run `npm install` to install the dependencies.
1. Set up a local CHT instance using theses [instructions](https://docs.communityhealthtoolkit.org/apps/tutorials/local-setup/)
1. Set up a proxy to your local CHT instance by running using something like [nginx-local-ip](https://github.com/medic/nginx-local-ip) or [ngrok](https://ngrok.com/) and update the `CHT_URL` value in the `.env` file with the new URL.
1. Ensure you have [cht-conf](https://www.npmjs.com/package/cht-conf) installed and run `cht --local` to compile and upload the app settings configuration to your local CHT instance.## Shutdown the servers

- To shut-down the containers run `./startup.sh down` to stop the instances.
- To then restart the containers, run `./startup.sh up`. You do not need to run init again like you did in install above.
- To shut-down and delete everything, run `./startup.sh destroy`.

Users getting errors when running the installation steps, please see the [Troubleshooting guide](/troubleshooting.md).
