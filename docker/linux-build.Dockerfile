FROM node:24-bookworm

RUN apt-get update \
  && apt-get install --no-install-recommends -y fakeroot dpkg rpm zip \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

CMD ["npm", "run", "make", "--", "--platform", "linux", "--arch", "x64", "--targets", "deb,rpm,@electron-forge/maker-zip"]
