const { format, add } = require("date-fns");

const dateBet = () => {
  const now = add(new Date(), { days: 1 });
  return format(now, "yyyy-MM-dd");
};

const dateNow = () => {
  const now = new Date();
  return format(now, "yyyy-MM-dd");
};

const resolveUser = (author) => {
  return `${author.username}#${author.discriminator}`;
};

module.exports = {
  dateBet,
  dateNow,
  resolveUser,
};
