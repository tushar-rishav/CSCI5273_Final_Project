FROM node:16

WORKDIR /app

# FIXME: git clone source code
COPY package*.json ./

RUN npm install

EXPOSE 9000
EXPOSE 9001

ENTRYPOINT ["npm", "run"]
# start metadataserver by default
CMD ["start-mds"]
